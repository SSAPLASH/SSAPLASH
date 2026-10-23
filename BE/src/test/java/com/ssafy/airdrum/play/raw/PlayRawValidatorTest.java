package com.ssafy.airdrum.play.raw;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayErrorCode;
import com.ssafy.airdrum.play.PlayFixtures;
import com.ssafy.airdrum.play.PlayJson;
import static org.assertj.core.api.Assertions.*;

class PlayRawValidatorTest {
	final UUID id=UUID.randomUUID(); final PlayRawValidator validator=new PlayRawValidator(new PlayJson());
	PlayRawValidator.Validated validate(byte[] bytes) { return validator.validate(new ByteArrayInputStream(bytes),id,Map.of(0,new com.ssafy.airdrum.play.PlaySessionRepository.SensorHit(0,-10.125))); }
	@Test void digestIsOverDecodedBytesAndGzipMetadataDoesNotMatter() {
		String raw=PlayFixtures.raw(id); byte[] zipped=PlayFixtures.gzip(raw); var a=validate(zipped);
		zipped[4]=1; assertThat(validate(zipped)).isEqualTo(a);
		assertThat(a.hash()).isEqualTo(HexFormat.of().formatHex(PlayJson.sha256().digest(raw.getBytes(StandardCharsets.UTF_8))));
		assertThat(a.bytes()).isEqualTo(raw.getBytes(StandardCharsets.UTF_8).length);
		assertThat(validate(PlayFixtures.gzip(raw+" ")).hash()).isNotEqualTo(a.hash());
	}
	@Test void malformedCrcTrailingBytesAndSecondMemberAreRejected() {
		byte[] valid=PlayFixtures.gzip(PlayFixtures.raw(id));
		byte[] crc=valid.clone(); crc[crc.length-8]^=1;
		var twice=new ByteArrayOutputStream(); twice.writeBytes(valid); twice.writeBytes(valid);
		for(byte[] bad:new byte[][]{crc,java.util.Arrays.copyOf(valid,valid.length-1),java.util.Arrays.copyOf(valid,valid.length+1),twice.toByteArray()})
			assertThatThrownBy(()->validate(bad)).isInstanceOf(BusinessException.class);
	}
	@Test void strictRawSchemaRejectsUnknownDuplicatesClockAndInvalidSamples() {
		String raw=PlayFixtures.raw(id);
		for(String bad:new String[]{raw.replace(id.toString(),UUID.randomUUID().toString()),raw.replace("\"tHit\":1000","\"tHit\":1000.0"),
				raw.replace("\"tAudio\":-10.125","\"tAudio\":\"-10.125\""),raw.replace("\"tAudio\":-10.125","\"tAudio\":0"),raw.replace("-32768","-32769"),
				raw.replace("0,0,0,0,0,0","0,0,0"),raw.replace("\"seq\":0","\"seq\":1"),raw.replace("\"stickId\":0","\"stickId\":1"),
				raw.replace("\"sensorTickHz\":1000","\"sensorTickHz\":1000,\"sensorTickHz\":1000"),
				raw.replace("\"gyroScale\":0.001","\"secret\":\"not-accepted\""),raw+"{}"})
			assertThatThrownBy(()->validate(PlayFixtures.gzip(bad))).isInstanceOf(BusinessException.class);
	}
	@Test void sensorRowsMustMatchSummaryAndKeyboardCanHaveEmptyRaw() {
		assertThatThrownBy(()->validator.validate(new ByteArrayInputStream(PlayFixtures.gzip(PlayFixtures.raw(id))),id,Map.of())).isInstanceOf(BusinessException.class);
		String empty="{\"schemaVersion\":1,\"playId\":\""+id+"\",\"clockContext\":{\"sensorTickHz\":1000,\"browserClock\":\"PERFORMANCE_NOW\",\"audioClock\":\"SONG_POSITION\"},\"hits\":[]}";
		assertThat(validator.validate(new ByteArrayInputStream(PlayFixtures.gzip(empty)),id,Map.of()).bytes()).isPositive();
	}
	@Test void expansionLimitIsEnforcedWithoutBuildingHugeJsonTree() throws Exception {
		var out=new ByteArrayOutputStream();
		try(var gz=new GZIPOutputStream(out)) {
			gz.write(PlayFixtures.raw(id).getBytes(StandardCharsets.UTF_8));
			byte[] spaces=new byte[8192]; java.util.Arrays.fill(spaces,(byte)' ');
			for(int i=0;i<8192;i++) gz.write(spaces);
		}
		assertThatThrownBy(()->validate(out.toByteArray())).isInstanceOfSatisfying(BusinessException.class,
				ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE));
	}
	@Test void nonUtf8AndTruncatedJsonAreRejected() {
		byte[] utf=PlayFixtures.raw(id).getBytes(StandardCharsets.UTF_16LE);
		var out=new ByteArrayOutputStream();
		try(var gz=new GZIPOutputStream(out)) { gz.write(utf); } catch(Exception ex) { throw new RuntimeException(ex); }
		assertThatThrownBy(()->validate(out.toByteArray())).isInstanceOf(BusinessException.class);
		assertThatThrownBy(()->validate(PlayFixtures.gzip("{"))).isInstanceOf(BusinessException.class);
	}
}
