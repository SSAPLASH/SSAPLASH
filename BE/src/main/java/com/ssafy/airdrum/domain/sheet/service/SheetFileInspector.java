package com.ssafy.airdrum.domain.sheet.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.imageio.ImageIO;
import javax.imageio.stream.FileImageInputStream;

import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.sheet.exception.SheetError;
import com.ssafy.airdrum.global.error.BusinessException;

/**
 * 악보 파일의 실제 바이트를 검사한다(155번 설계 1절 상한 표). 확장자·Content-Type은 믿지 않는다.
 * 이미지는 원본 크기로 펼치지 않고 400만 화소 이하로 줄여 끝까지 읽는다. 운영 힙(약 460MB)을 지키기 위해서다.
 */
@Component
class SheetFileInspector {
	static final int MAX_IMAGE_BYTES = 10 * 1024 * 1024;
	static final int MAX_PDF_BYTES = 20 * 1024 * 1024;
	static final int MAX_SIDE = 8000;
	static final long MAX_PIXELS = 40_000_000L;
	static final long DECODE_PIXELS = 4_000_000L;

	enum Kind { IMAGE, PDF }

	record Inspected(Kind kind, String extension, String contentType, Integer width, Integer height) {}

	Inspected inspect(Path file) {
		try {
			long size = Files.size(file);
			if (size == 0) throw error(SheetError.SHEET_INVALID);
			if (startsWithPdf(file)) {
				if (size > MAX_PDF_BYTES) throw error(SheetError.SHEET_TOO_LARGE);
				if (!pdfEnds(file, size)) throw error(SheetError.SHEET_INVALID);
				return new Inspected(Kind.PDF, "pdf", "application/pdf", null, null);
			}
			if (size > MAX_IMAGE_BYTES) throw error(SheetError.SHEET_TOO_LARGE);
			return image(file);
		} catch (BusinessException e) {
			throw e;
		} catch (IOException | RuntimeException e) {
			throw error(SheetError.SHEET_INVALID);
		}
	}

	/** 줄여 읽을 간격. 가로·세로를 같은 간격으로 건너뛰어 펼친 화소가 DECODE_PIXELS 이하가 되게 한다. */
	static int subsampling(int width, int height) {
		return (int) Math.max(1, Math.ceil(Math.sqrt((double) width * height / DECODE_PIXELS)));
	}

	private Inspected image(Path file) throws IOException {
		try (var input = new FileImageInputStream(file.toFile())) {
			var readers = ImageIO.getImageReaders(input);
			if (!readers.hasNext()) throw error(SheetError.SHEET_UNSUPPORTED);
			var reader = readers.next();
			try {
				String extension = switch (reader.getFormatName().toLowerCase(Locale.ROOT)) {
					case "jpeg", "jpg" -> "jpg";
					case "png" -> "png";
					case "webp" -> "webp";
					default -> throw error(SheetError.SHEET_UNSUPPORTED);
				};
				if (!complete(file, extension)) throw error(SheetError.SHEET_INVALID);
				var warning = new AtomicBoolean();
				reader.addIIOReadWarningListener((source, message) -> warning.set(true));
				reader.setInput(input, true, true);
				int width = reader.getWidth(0), height = reader.getHeight(0);
				if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || (long) width * height > MAX_PIXELS)
					throw error(SheetError.SHEET_INVALID);
				var param = reader.getDefaultReadParam();
				int step = subsampling(width, height);
				param.setSourceSubsampling(step, step, 0, 0);
				if (reader.read(0, param) == null || warning.get()) throw error(SheetError.SHEET_INVALID);
				return new Inspected(Kind.IMAGE, extension, extension.equals("jpg") ? "image/jpeg" : "image/" + extension, width, height);
			} finally {
				reader.dispose();
			}
		}
	}

	private static boolean startsWithPdf(Path file) throws IOException {
		try (InputStream in = Files.newInputStream(file)) {
			byte[] head = in.readNBytes(5);
			return head.length == 5 && head[0] == '%' && head[1] == 'P' && head[2] == 'D' && head[3] == 'F' && head[4] == '-';
		}
	}

	/** PDF 끝 1KiB 안에 %%EOF가 있어야 한다. 잘린 업로드를 거른다. */
	private static boolean pdfEnds(Path file, long size) throws IOException {
		byte[] tail = tail(file, size, 1024);
		for (int i = tail.length - 5; i >= 0; i--)
			if (tail[i] == '%' && tail[i + 1] == '%' && tail[i + 2] == 'E' && tail[i + 3] == 'O' && tail[i + 4] == 'F') return true;
		return false;
	}

	/** 형식별 끝 표시(JPG EOI, PNG IEND, WEBP RIFF 길이)를 확인한다. CoverImage와 같은 규칙을 파일에 적용한다. */
	private static boolean complete(Path file, String format) throws IOException {
		long n = Files.size(file);
		if (format.equals("jpg")) {
			byte[] t = tail(file, n, 2);
			return n >= 4 && (t[0] & 255) == 255 && (t[1] & 255) == 217;
		}
		if (format.equals("png")) {
			byte[] t = tail(file, n, 12);
			return n >= 20 && t[0] == 0 && t[1] == 0 && t[2] == 0 && t[3] == 0 && t[4] == 'I' && t[5] == 'E' && t[6] == 'N' && t[7] == 'D';
		}
		byte[] h;
		try (InputStream in = Files.newInputStream(file)) {
			h = in.readNBytes(12);
		}
		if (h.length < 12 || h[0] != 'R' || h[1] != 'I' || h[2] != 'F' || h[3] != 'F' || h[8] != 'W' || h[9] != 'E' || h[10] != 'B' || h[11] != 'P') return false;
		long riff = (h[4] & 255L) | ((h[5] & 255L) << 8) | ((h[6] & 255L) << 16) | ((h[7] & 255L) << 24);
		return riff + 8 == n;
	}

	private static byte[] tail(Path file, long size, int count) throws IOException {
		int len = (int) Math.min(size, count);
		byte[] out = new byte[len];
		try (var raf = new RandomAccessFile(file.toFile(), "r")) {
			raf.seek(size - len);
			raf.readFully(out);
		}
		return out;
	}

	private static BusinessException error(SheetError code) {
		return new BusinessException(code);
	}
}
