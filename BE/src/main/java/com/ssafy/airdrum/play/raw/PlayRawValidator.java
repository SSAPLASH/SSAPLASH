package com.ssafy.airdrum.play.raw;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayErrorCode;
import com.ssafy.airdrum.play.PlayJson;
import com.ssafy.airdrum.play.PlaySessionRepository.SensorHit;
import static com.ssafy.airdrum.play.PlayUploadValidator.check;

/** 샘플 배열을 보관하지 않고 순차 검사한다. 메모리에는 식별자 집합만 남긴다. */
@Component
public class PlayRawValidator {
	public static final long COMPRESSED_LIMIT = 20L*1024*1024, EXPANDED_LIMIT = 64L*1024*1024;
	private final PlayJson json;
	public PlayRawValidator(PlayJson json) { this.json=json; }
	public record Validated(String hash,long bytes) {}
	public Validated validate(InputStream compressed, UUID play, Map<Integer,SensorHit> expected) {
		var digest=PlayJson.sha256();
		try (var gz=new SingleMemberGzipInputStream(new Limited(compressed,COMPRESSED_LIMIT));
				var limited=new Limited(gz,EXPANDED_LIMIT);
				var stream=new DigestInputStream(limited,digest);
				var reader=new InputStreamReader(stream,StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT));
				var p=json.mapper().tokenStreamFactory().createParser(reader)) {
			check(p.nextToken()==JsonToken.START_OBJECT);
			var fields=new HashSet<String>();
			while(p.nextToken()!=JsonToken.END_OBJECT) {
				String f=field(p,fields); p.nextToken();
				switch(f) {
					case "schemaVersion" -> { if(integer(p)!=1) throw new BusinessException(PlayErrorCode.PLAY_SCHEMA_UNSUPPORTED); }
					case "playId" -> check(string(p).equals(play.toString()));
					case "clockContext" -> clock(p,!expected.isEmpty());
					case "hits" -> hits(p,expected);
					default -> check(false);
				}
			}
			check(fields.equals(Set.of("schemaVersion","playId","clockContext","hits")) && p.nextToken()==null);
			return new Validated(HexFormat.of().formatHex(digest.digest()),limited.count);
		} catch (BusinessException ex) { throw ex; }
		catch (Exception ex) { throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_INVALID); }
	}
	private void clock(JsonParser p,boolean hasSensor) {
		check(p.currentToken()==JsonToken.START_OBJECT); var fields=new HashSet<String>();
		while(p.nextToken()!=JsonToken.END_OBJECT) {
			String f=field(p,fields); p.nextToken();
			switch(f) {
				case "sensorTickHz" -> { if(!hasSensor && p.currentToken()==JsonToken.VALUE_NULL) break; double n=number(p); check(n>0 && n<=1e9); }
				case "browserClock" -> check("PERFORMANCE_NOW".equals(string(p)));
				case "audioClock" -> check("SONG_POSITION".equals(string(p)));
				default -> check(false);
			}
		}
		check(fields.equals(Set.of("sensorTickHz","browserClock","audioClock")));
	}
	private void hits(JsonParser p,Map<Integer,SensorHit> expected) {
		check(p.currentToken()==JsonToken.START_ARRAY); var seen=new HashSet<Integer>(); var ids=new HashSet<String>();
		while(p.nextToken()!=JsonToken.END_ARRAY) {
			check(seen.size()<PlayJson.MAX_HITS && p.currentToken()==JsonToken.START_OBJECT);
			var fields=new HashSet<String>(); Integer seq=null,stick=null;
			double recv=0,resolved=0,audio=0;
			while(p.nextToken()!=JsonToken.END_OBJECT) {
				String f=field(p,fields); p.nextToken();
				switch(f) {
					case "seq" -> { long n=integer(p); check(n>=0 && n<PlayJson.MAX_HITS); seq=(int)n; }
					case "stickId" -> { long n=integer(p); check(n==0 || n==1); stick=(int)n; }
					case "hitId" -> { String id=string(p); check(!id.isBlank() && id.length()<=64 && ids.add(id)); }
					case "tHit" -> { long n=integer(p); check(n>=0 && n<=9007199254740991L); }
					case "tRecv" -> { recv=number(p); check(recv>=0); }
					case "tResolved" -> { resolved=number(p); check(resolved>=0); }
					case "tAudio" -> audio=number(p);
					case "swingWindow" -> window(p);
					default -> check(false);
				}
			}
			check(fields.equals(Set.of("seq","stickId","hitId","tHit","tRecv","tResolved","tAudio","swingWindow")));
			var hit=expected.get(seq);
			check(seq!=null && stick!=null && hit!=null && stick==hit.stickId() && Math.abs(audio-hit.tMs())<=.001 && seen.add(seq) && resolved>=recv);
		}
		check(seen.equals(expected.keySet()));
	}
	private void window(JsonParser p) {
		check(p.currentToken()==JsonToken.START_OBJECT); var fields=new HashSet<String>();
		while(p.nextToken()!=JsonToken.END_OBJECT) {
			String f=field(p,fields); p.nextToken();
			if(f.equals("samples")) {
				check(p.currentToken()==JsonToken.START_ARRAY); int rows=0;
				while(p.nextToken()!=JsonToken.END_ARRAY) {
					check(++rows<=512 && p.currentToken()==JsonToken.START_ARRAY); int axes=0;
					while(p.nextToken()!=JsonToken.END_ARRAY) { long n=integer(p); check(++axes<=6 && n>=-32768 && n<=32767); }
					check(axes==6);
				} check(rows>0);
			} else if(Set.of("sampleRateHz","accelScale","gyroScale").contains(f)) {
				double n=number(p); check(n>0 && n<=10000);
			} else check(false);
		}
		check(fields.equals(Set.of("sampleRateHz","accelScale","gyroScale","samples")));
	}
	private static String field(JsonParser p,Set<String> seen) { check(p.currentToken()==JsonToken.PROPERTY_NAME); String f=p.currentName(); check(seen.add(f)); return f; }
	private static String string(JsonParser p) { check(p.currentToken()==JsonToken.VALUE_STRING); return p.getString(); }
	private static long integer(JsonParser p) { check(p.currentToken()==JsonToken.VALUE_NUMBER_INT); return p.getLongValue(); }
	private static double number(JsonParser p) { check(p.currentToken()!=null && p.currentToken().isNumeric()); double n=p.getDoubleValue(); check(Double.isFinite(n)); return n; }
	private static final class Limited extends FilterInputStream {
		final long limit; long count;
		Limited(InputStream in,long limit) { super(in); this.limit=limit; }
		@Override public int read() throws IOException { int n=in.read(); if(n>=0) added(1); return n; }
		@Override public int read(byte[] b,int off,int len) throws IOException { int n=in.read(b,off,(int)Math.min(len,limit-count+1)); if(n>0) added(n); return n; }
		private void added(int n) { count+=n; if(count>limit) throw new BusinessException(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE); }
	}
}
