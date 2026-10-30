package com.ssafy.airdrum.chart.job;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.auth.AuthenticationService;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.common.response.PageResponse;

@Service
public class JobQueryService {
    private static final String COLUMNS="j.id,j.song_id,j.status,j.progress,j.revision,j.error_code,j.created_at,j.started_at,j.finished_at";
    private static final String VISIBLE=" FROM chart_jobs j JOIN songs s ON s.id=j.song_id JOIN users u ON u.id=j.user_id WHERE j.user_id=? AND s.owner_id=j.user_id AND s.deleted_at IS NULL AND u.status='ACTIVE'";
    private final JdbcTemplate db;
    private final AuthenticationService authentication;
    public JobQueryService(JdbcTemplate db, AuthenticationService authentication) { this.db=db; this.authentication=authentication; }
    private static Instant instant(Timestamp value) { return value==null ? null : value.toInstant(); }
    private JobSnapshot map(ResultSet row,int index) throws SQLException {
        String code=row.getString(6);
        JobSnapshot.JobError error=code==null ? null : safeError(code);
        return new JobSnapshot(row.getLong(1),row.getLong(2),JobSnapshot.Status.valueOf(row.getString(3)),row.getInt(4),row.getLong(5),error,
                instant(row.getTimestamp(7)),instant(row.getTimestamp(8)),instant(row.getTimestamp(9)));
    }
    private JobSnapshot.JobError safeError(String code) {
        return switch(code) {
            case "INPUT_INVALID" -> new JobSnapshot.JobError(code,"입력 파일을 처리할 수 없습니다.");
            case "OUTPUT_INVALID" -> new JobSnapshot.JobError(code,"채보 결과를 처리할 수 없습니다.");
            case "MODEL_FAILED" -> new JobSnapshot.JobError(code,"채보 생성에 실패했습니다.");
            case "JOB_CANCELLED" -> new JobSnapshot.JobError(code,"작업이 취소되었습니다.");
            default -> new JobSnapshot.JobError("JOB_FAILED","작업을 완료할 수 없습니다.");
        };
    }
    public Optional<JobSnapshot> visible(long userId,long jobId) {
        var rows=db.query("SELECT "+COLUMNS+VISIBLE+" AND j.id=?",this::map,userId,jobId);
        return rows.stream().findFirst();
    }
    public JobSnapshot detail(long userId,long jobId) {
        if(authentication.findActive(userId).isEmpty()) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        return visible(userId,jobId).orElseThrow(()->new BusinessException(CommonErrorCode.NOT_FOUND));
    }
    @Transactional(readOnly=true)
    public PageResponse<JobSnapshot> list(long userId,JobSnapshot.Status status,int page,int size) {
        if(authentication.findActive(userId).isEmpty()) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
        String filter=status==null ? "" : " AND j.status=?";
        Object[] countArgs=status==null ? new Object[]{userId} : new Object[]{userId,status.name()};
        Long total=db.queryForObject("SELECT count(*)"+VISIBLE+filter,Long.class,countArgs);
        Object[] args=status==null ? new Object[]{userId,size,(long)page*size} : new Object[]{userId,status.name(),size,(long)page*size};
        List<JobSnapshot> items=db.query("SELECT "+COLUMNS+VISIBLE+filter+" ORDER BY j.created_at DESC,j.id DESC LIMIT ? OFFSET ?",this::map,args);
        return PageResponse.of(items,page,size,total);
    }
}
