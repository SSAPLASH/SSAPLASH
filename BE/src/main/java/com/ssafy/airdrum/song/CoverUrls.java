package com.ssafy.airdrum.song;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;
import com.ssafy.airdrum.common.error.BusinessException;

@Component
class CoverUrls {
    private final CoverStorage store; private final ChartAssetKeyPolicy keys; private final JdbcTemplate db;
    CoverUrls(CoverStorage store,ChartAssetKeyPolicy keys,JdbcTemplate db) { this.store=store;this.keys=keys;this.db=db; }
    /** 개인 커버는 소유자에게만, 공용 곡 커버(156번)는 공개된 곡이면 모든 회원에게 서명한다. */
    Map<Long,String> forSongs(long user,List<SongRepository.View> rows) {
        var signed=new HashMap<Long,String>(); var expected=new HashMap<Long,String>(); var builtin=new HashMap<Long,String>();
        for(var row:rows) {
            if(row.getCoverKey()==null) continue;
            boolean own=row.getOwnerId()!=null && row.getOwnerId()==user && !"BUILTIN".equals(row.getSource());
            boolean shared=row.getOwnerId()==null && "BUILTIN".equals(row.getSource());
            if(!own && !shared) continue;
            try { if(own) keys.cover(user,row.getId(),row.getCoverKey()); else keys.builtinCover(row.getId(),row.getCoverKey()); }
            catch(IllegalStateException ex) { throw new BusinessException(SongManagementError.COVER_UNAVAILABLE); }
            (own?expected:builtin).put(row.getId(),row.getCoverKey()); signed.put(row.getId(),store.sign(row.getCoverKey()));
        }
        if(expected.isEmpty() && builtin.isEmpty()) return signed;
        var allowed=new java.util.HashSet<Long>();
        if(!expected.isEmpty()) {
            var args=new java.util.ArrayList<Object>(); args.add(user); args.addAll(expected.keySet());
            var current=db.query("SELECT s.id,s.cover_key FROM songs s JOIN users u ON u.id=s.owner_id WHERE s.owner_id=? AND u.status='ACTIVE' AND s.deleted_at IS NULL AND s.id IN ("+placeholders(expected.size())+")",(r,n)->new Object[]{r.getLong(1),r.getString(2)},args.toArray());
            for(var row:current) if(java.util.Objects.equals(expected.get((Long)row[0]),row[1])) allowed.add((Long)row[0]);
        }
        if(!builtin.isEmpty()) {
            var current=db.query("SELECT s.id,s.cover_key FROM songs s WHERE s.owner_id IS NULL AND s.source='BUILTIN' AND s.published AND s.deleted_at IS NULL AND s.id IN ("+placeholders(builtin.size())+")",(r,n)->new Object[]{r.getLong(1),r.getString(2)},builtin.keySet().toArray());
            for(var row:current) if(java.util.Objects.equals(builtin.get((Long)row[0]),row[1])) allowed.add((Long)row[0]);
        }
        signed.keySet().retainAll(allowed); return signed;
    }
    private static String placeholders(int n) { return String.join(",",java.util.Collections.nCopies(n,"?")); }
}
