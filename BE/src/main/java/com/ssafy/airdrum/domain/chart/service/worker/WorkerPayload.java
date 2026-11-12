package com.ssafy.airdrum.domain.chart.service.worker;

import com.ssafy.airdrum.global.worker.WorkerError;

import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.TreeSet;
import com.ssafy.airdrum.global.error.BusinessException;
import org.springframework.stereotype.Component;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class WorkerPayload {
    static final int MAX_BYTES=5*1024*1024;
    private final JsonMapper json=JsonMapper.builder(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(24).maxStringLength(4096).maxNumberLength(64).maxNameLength(128).build())
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
    public JsonNode read(InputStream input) {
        try {
            byte[] bytes=input.readNBytes(MAX_BYTES+1);
            if(bytes.length>MAX_BYTES) throw new BusinessException(WorkerError.INVALID);
            var value=json.readTree(bytes);
            if(value==null || !value.isObject()) throw new BusinessException(WorkerError.INVALID);
            return value;
        } catch(BusinessException e) { throw e; }
        catch(Exception e) { throw new BusinessException(WorkerError.INVALID); }
    }
    String write(Object node) { return json.writeValueAsString(node); }
    public String hash(JsonNode node) {
        try {
            var digest=MessageDigest.getInstance("SHA-256");
            canonical(node,digest);
            return HexFormat.of().formatHex(digest.digest());
        } catch(BusinessException e) { throw e; }
        catch(Exception e) { throw new IllegalStateException(e); }
    }
    private void canonical(JsonNode n, MessageDigest d) {
        if(n==null) throw new BusinessException(WorkerError.INVALID);
        if(n.isObject()) {
            update(d,"{"); var fields=new TreeSet<String>(); n.properties().forEach(e->fields.add(e.getKey()));
            boolean first=true; for(var k:fields) { if(!first) update(d,","); first=false; update(d,json.writeValueAsString(k)); update(d,":"); canonical(n.get(k),d); } update(d,"}");
        } else if(n.isArray()) {
            update(d,"["); boolean first=true; for(var v:n) { if(!first) update(d,","); first=false; canonical(v,d); } update(d,"]");
        } else if(n.isNumber()) {
            BigDecimal number=new BigDecimal(n.asString()).stripTrailingZeros();
            if(Math.abs((long)number.scale())>128 || number.precision()>128) throw new BusinessException(WorkerError.INVALID);
            update(d,number.signum()==0?"0":number.toPlainString());
        } else update(d,json.writeValueAsString(n));
    }
    private static void update(MessageDigest d,String s) { d.update(s.getBytes(StandardCharsets.UTF_8)); }
}
