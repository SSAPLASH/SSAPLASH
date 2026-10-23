package com.ssafy.airdrum.play.raw;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayErrorCode;
import com.ssafy.airdrum.play.PlaySessionRepository;
import static com.ssafy.airdrum.play.PlayUploadValidator.check;

@Service
public class PlayRawUploadService {
	private final PlaySessionRepository sessions;
	private final PlayRawValidator validator;
	private final PlayRawUploadRepository receipts;
	private final PlayRawStore store;
	public PlayRawUploadService(PlaySessionRepository sessions,PlayRawValidator validator,PlayRawUploadRepository receipts,PlayRawStore store) {
		this.sessions=sessions; this.validator=validator; this.receipts=receipts; this.store=store;
	}
	public void upload(long user,UUID play,MultipartFile file) {
		var snapshot=sessions.rawSnapshot(play,user);
		check(file!=null && !file.isEmpty());
		if(file.getSize()>PlayRawValidator.COMPRESSED_LIMIT) throw new BusinessException(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE);
		PlayRawValidator.Validated payload;
		try { payload=validator.validate(file.getInputStream(),play,snapshot.hits()); }
		catch(IOException ex) { throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_INVALID); }
		var attempt=receipts.begin(user,play,snapshot.hash(),payload);
		if(attempt==null) return;
		try {
			store.checkAvailable();
			store.put(attempt.key(),file.getSize(),()-> { try { return file.getInputStream(); } catch(IOException ex) { throw new UncheckedIOException(ex); } });
			var result=receipts.accept(user,play,attempt.id());
			if(result!=null) throw new BusinessException(result);
		} catch(RuntimeException ex) {
			// 커밋 결과가 불명확하면 인수 기록을 먼저 확인한다. DB도 장애면 만료 복구가 맡는다.
			try {
				if(receipts.isAccepted(attempt.id())) return;
				receipts.settle(attempt.id());
			} catch(RuntimeException recoveryFailure) {
				throw new BusinessException(PlayErrorCode.PLAY_RAW_STORAGE_UNAVAILABLE);
			}
			throw ex;
		}
	}
}
