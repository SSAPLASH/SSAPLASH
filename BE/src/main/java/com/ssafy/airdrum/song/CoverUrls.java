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
    Map<Long,String> forSongs(long user,List<SongRepository.View> rows) {
        var signed=new HashMap<Long,String>(); var expected=new HashMap<Long,String>();
        for(var row:rows) if(row.getCoverKey()!=null && row.getOwnerId()!=null && row.getOwnerId()==user && !"BUILTIN".equals(row.getSource())) {
            try { keys.cover(user,row.getId(),row.getCoverKey()); }
            catch(IllegalStateException ex) { throw new BusinessException(SongManagementError.COVER_UNAVAILABLE); }
            expected.put(row.getId(),row.getCoverKey()); signed.put(row.getId(),store.sign(row.getCoverKey()));
        }
        if(expected.isEmpty()) return signed;
        String placeholders=String.join(",",java.util.Collections.nCopies(expected.size(),"?"));
        var ids=expected.keySet().stream().toList(); var args=new java.util.ArrayList<Object>(); args.add(user); args.addAll(ids);
        var current=db.query("SELECT s.id,s.cover_key FROM songs s JOIN users u ON u.id=s.owner_id WHERE s.owner_id=? AND u.status='ACTIVE' AND s.deleted_at IS NULL AND s.id IN ("+placeholders+")",(r,n)->new Object[]{r.getLong(1),r.getString(2)},args.toArray());
        var allowed=new java.util.HashSet<Long>();
        for(var row:current) if(java.util.Objects.equals(expected.get((Long)row[0]),row[1])) allowed.add((Long)row[0]);
        signed.keySet().retainAll(allowed); return signed;
    }
}
