package com.ssafy.airdrum.domain.sheet.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Semaphore;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.domain.sheet.exception.SheetError;
import com.ssafy.airdrum.domain.sheet.repository.SheetMusicRepository;
import com.ssafy.airdrum.domain.sheet.scheduler.SheetCleanup;
import com.ssafy.airdrum.domain.sheet.storage.SheetStorage;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.domain.chart.storage.ChartAssetKeyPolicy;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.response.PageResponse;
import com.ssafy.airdrum.global.multipart.SpoolDirectory;
import com.ssafy.airdrum.domain.sheet.service.SheetFileInspector.Inspected;
import com.ssafy.airdrum.domain.sheet.service.SheetFileInspector.Kind;
import com.ssafy.airdrum.domain.sheet.repository.SheetMusicRepository.Page;
import com.ssafy.airdrum.domain.sheet.repository.SheetMusicRepository.Row;
import com.ssafy.airdrum.domain.sheet.dto.SheetResponses.SheetDetail;
import com.ssafy.airdrum.domain.sheet.dto.SheetResponses.SheetPage;
import com.ssafy.airdrum.domain.sheet.dto.SheetResponses.SheetSummary;

/**
 * 내 악보 등록·조회·수정·삭제(155번 설계 4절). 업로드는 임시 정리 등록 → 저장소 PUT → 페이지 연결 순서라
 * 어느 단계에서 실패해도 연결되지 않은 파일은 정리 작업자가 지운다.
 */
@Service
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SheetMusicService {
	static final int MAX_PAGES = 20;
	static final long MAX_SHEETS = 100;
	static final long MAX_TOTAL_BYTES = 500L * 1024 * 1024;
	static final Duration URL_TTL = Duration.ofHours(1);

	/** 검사·저장 단계만 동시 2건으로 묶는다. 본문을 받는 동안은 막지 않는다(설계 v0.2). */
	private final Semaphore slots = new Semaphore(2);
	private final SheetMusicRepository sheets;
	private final SheetFileInspector inspector;
	private final SheetStorage storage;
	private final SheetCleanup cleanup;
	private final ChartAssetKeyPolicy keys;
	private final SpoolDirectory spool;
	private final TransactionTemplate tx;

	SheetMusicService(SheetMusicRepository sheets, SheetFileInspector inspector, SheetStorage storage, SheetCleanup cleanup,
			ChartAssetKeyPolicy keys, SpoolDirectory spool, PlatformTransactionManager manager) {
		this.sheets = sheets;
		this.inspector = inspector;
		this.storage = storage;
		this.cleanup = cleanup;
		this.keys = keys;
		this.spool = spool;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	/** @param songId 248: 연결할 개인 곡. null이면 곡 없는 악보 */
	public SheetDetail register(long user, String title, String source, Long songId, List<MultipartFile> files) {
		if (files.isEmpty() || files.size() > MAX_PAGES) throw new BusinessException(SheetError.SHEET_INVALID);
		if (!slots.tryAcquire()) throw new BusinessException(SheetError.SHEET_UNAVAILABLE);
		var temps = new ArrayList<Path>();
		try {
			var inspected = new ArrayList<Inspected>();
			var sizes = new ArrayList<Long>();
			for (var file : files) {
				Path temp = Files.createTempFile(spool.path(), "sheet-", ".upload");
				temps.add(temp);
				sizes.add(copy(file, temp));
				inspected.add(inspector.inspect(temp));
			}
			boolean pdf = inspected.stream().anyMatch(i -> i.kind() == Kind.PDF);
			if (pdf && inspected.size() != 1) throw new BusinessException(SheetError.SHEET_INVALID);
			long total = sizes.stream().mapToLong(Long::longValue).sum();
			String kind = pdf ? "PDF" : "IMAGE";

			var pages = new ArrayList<Page>();
			long id = tx.execute(s -> {
				sheets.lockOwner(user);
				if (sheets.liveCount(user) >= MAX_SHEETS || sheets.liveBytes(user) + total > MAX_TOTAL_BYTES)
					throw new BusinessException(SheetError.SHEET_QUOTA_EXCEEDED);
				if (songId != null) {
					// 248: 남의 곡·없는 곡·지운 곡·공용 곡은 모두 404(FE 요청). 곡당 살아 있는 악보는 하나다.
					if (!sheets.ownSong(user, songId)) throw new BusinessException(ChartErrorCode.SONG_NOT_FOUND);
					if (sheets.linked(songId)) throw new BusinessException(SheetError.SHEET_ALREADY_LINKED);
				}
				long created;
				try {
					created = sheets.insert(user, title, source, kind, inspected.size(), total, songId);
				} catch (DuplicateKeyException ex) {
					// 같은 곡에 동시에 올린 경우 부분 유일 인덱스가 막는다
					throw new BusinessException(SheetError.SHEET_ALREADY_LINKED);
				}
				for (int i = 0; i < inspected.size(); i++) {
					var info = inspected.get(i);
					String key = "sheet-music/" + user + "/" + created + "/" + UUID.randomUUID() + "." + info.extension();
					keys.sheetMusic(user, created, key);
					cleanup.temporary(user, key);
					pages.add(new Page(i + 1, key, info.contentType(), sizes.get(i), info.width(), info.height()));
				}
				return created;
			});
			try {
				for (int i = 0; i < pages.size(); i++) storage.put(pages.get(i).key(), temps.get(i), pages.get(i).bytes(), pages.get(i).contentType());
				tx.executeWithoutResult(s -> {
					if (!sheets.lockOwn(user, id)) throw new BusinessException(SheetError.SHEET_UNAVAILABLE);
					for (var page : pages) if (!sheets.temporaryAlive(page.key())) throw new BusinessException(SheetError.SHEET_UNAVAILABLE);
					for (var page : pages) sheets.insertPage(id, page);
				});
			} catch (RuntimeException ex) {
				tx.executeWithoutResult(s -> sheets.softDelete(id));
				throw new BusinessException(SheetError.SHEET_UNAVAILABLE);
			}
			return detail(user, id);
		} catch (IOException ex) {
			throw new BusinessException(SheetError.SHEET_UNAVAILABLE);
		} finally {
			for (Path temp : temps) try {
				Files.deleteIfExists(temp);
			} catch (IOException ignored) {
			}
			slots.release();
		}
	}

	public PageResponse<SheetSummary> list(long user, String q, int page, int size) {
		String pattern = "%" + (q == null ? "" : q.strip()).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
		var items = sheets.page(user, pattern, size, (long) page * size).stream()
				.map(r -> new SheetSummary(r.id(), r.title(), r.source(), r.kind(), r.pageCount(), r.totalBytes(), thumbnail(r), r.createdAt(), r.updatedAt(), r.songId()))
				.toList();
		return PageResponse.of(items, page, size, sheets.count(user, pattern));
	}

	public SheetDetail detail(long user, long id) {
		var r = sheets.find(user, id).orElseThrow(() -> new BusinessException(SheetError.SHEET_NOT_FOUND));
		Instant expires = Instant.now().plus(URL_TTL);
		var pages = sheets.pages(id).stream()
				.map(p -> new SheetPage(p.pageNo(), sign(r, p.key()), p.contentType(), p.width(), p.height(), p.bytes())).toList();
		String thumbnail = r.kind().equals("IMAGE") && !pages.isEmpty() ? pages.getFirst().url() : null;
		return new SheetDetail(r.id(), r.title(), r.source(), r.kind(), r.pageCount(), r.totalBytes(), thumbnail, r.createdAt(), r.updatedAt(), pages, expires,
				r.songId());
	}

	/** 333: PATCH의 songId 변경. {@code songId}가 null이면 "해제", 숫자면 "연결·옮김". 본문에 필드가 없으면 이 값 자체가 null이다. */
	public record SongChange(Long songId) {}

	/**
	 * 제목·곡 연결 수정(333번). {@code title}이 null이면 제목은 그대로, {@code songChange}가 null이면 연결은 그대로다.
	 * 연결 판정은 등록과 같다(본인 소유·삭제 안 됨·공용 아님 → 404, 그 곡에 살아 있는 다른 악보 → 409). 이미 다른 곡에 연결된 악보는 옮기고,
	 * 지금 연결된 곡과 같은 값이면 아무것도 바꾸지 않는다. {@code songId}가 null이면 해제한다.
	 */
	public SheetDetail update(long user, long id, String title, SongChange songChange) {
		tx.executeWithoutResult(s -> {
			if (!sheets.lockOwn(user, id)) throw new BusinessException(SheetError.SHEET_NOT_FOUND);
			var current = sheets.find(user, id).orElseThrow(() -> new BusinessException(SheetError.SHEET_NOT_FOUND));
			if (title != null) sheets.rename(id, title);
			if (songChange != null && !Objects.equals(current.songId(), songChange.songId())) {
				Long song = songChange.songId();
				if (song != null) {
					if (!sheets.ownSong(user, song)) throw new BusinessException(ChartErrorCode.SONG_NOT_FOUND);
					if (sheets.linked(song)) throw new BusinessException(SheetError.SHEET_ALREADY_LINKED);
				}
				try {
					sheets.link(id, song);
				} catch (DuplicateKeyException ex) {
					// 같은 곡에 동시에 연결한 경우 부분 유일 인덱스가 막는다
					throw new BusinessException(SheetError.SHEET_ALREADY_LINKED);
				}
			}
		});
		return detail(user, id);
	}

	public void delete(long user, long id) {
		tx.executeWithoutResult(s -> {
			if (!sheets.lockOwn(user, id) || sheets.find(user, id).isEmpty()) throw new BusinessException(SheetError.SHEET_NOT_FOUND);
			sheets.softDelete(id);
			cleanup.sheet(user, id);
		});
	}

	private String thumbnail(Row r) {
		return r.kind().equals("IMAGE") ? sheets.firstImage(r.id()).map(key -> sign(r, key)).orElse(null) : null;
	}

	/** DB 키라도 이 회원·악보에 귀속되지 않으면 서명하지 않는다. */
	private String sign(Row r, String key) {
		try {
			keys.sheetMusic(r.ownerId(), r.id(), key);
		} catch (IllegalStateException ex) {
			throw new BusinessException(SheetError.SHEET_UNAVAILABLE);
		}
		return storage.sign(key);
	}

	/** 선언 크기를 믿지 않고 읽은 바이트로 다시 센다. PDF 상한(20 MiB)을 넘으면 더 읽지 않는다. */
	private static long copy(MultipartFile file, Path temp) throws IOException {
		long count = 0;
		try (var input = file.getInputStream(); var output = Files.newOutputStream(temp)) {
			byte[] buffer = new byte[65536];
			int n;
			while ((n = input.read(buffer)) != -1) {
				count += n;
				if (count > SheetFileInspector.MAX_PDF_BYTES) throw new BusinessException(SheetError.SHEET_TOO_LARGE);
				output.write(buffer, 0, n);
			}
		}
		if (count == 0) throw new BusinessException(SheetError.SHEET_INVALID);
		return count;
	}
}
