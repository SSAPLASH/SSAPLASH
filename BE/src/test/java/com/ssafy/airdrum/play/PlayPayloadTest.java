package com.ssafy.airdrum.play;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import com.ssafy.airdrum.common.error.BusinessException;
import static org.assertj.core.api.Assertions.*;

class PlayPayloadTest {
	final PlayJson json=new PlayJson();
	final PlayUploadValidator validator=new PlayUploadValidator(json);
	final UUID id=UUID.fromString("9da79b76-5d88-4875-bc71-c826c3fb4293");
	PlayUploadRequest read(String s) { return json.read(new ByteArrayInputStream(s.getBytes(StandardCharsets.UTF_8))); }
	@Test void equivalentNumbersInstantsAndOptionalFieldsHaveOneHash() {
		var first=read(PlayFixtures.free(id));
		var second=read(PlayFixtures.free(id).replace("00:00:00Z","09:00:00+09:00").replace("\"pitch\":20","\"pitch\":20.0")
				.replace("\"schemaVersion\":1,","\"schemaVersion\":1,\"summary\":null,\"liveCoachEvents\":[],"));
		validator.structure(first); validator.structure(second);
		assertThat(json.hash(7,first)).isEqualTo(json.hash(7,second)).isNotEqualTo(json.hash(8,second));
		var reordered=json.mapper().readTree(PlayFixtures.free(id));
		assertThat(json.hash(7,read(reordered.toString()))).isEqualTo(json.hash(7,first));
	}
	@ParameterizedTest @ValueSource(strings={"\"surprise\":1,","\"consent\":false,","\"schemaVersion\":1,"})
	void unknownAndDuplicateFieldsAreRejected(String prefix) { assertThatThrownBy(()->read(PlayFixtures.free(id).replaceFirst("\\{","{"+prefix))).isInstanceOf(BusinessException.class); }
	@Test void noStringOrFractionCoercionAndRequiredConsent() {
		for(String bad: new String[]{PlayFixtures.free(id).replace("\"velocity\":85","\"velocity\":\"85\""),
				PlayFixtures.free(id).replace("\"velocity\":85","\"velocity\":85.1"),PlayFixtures.free(id).replace("\"consent\":false,","")})
			assertThatThrownBy(()->validator.structure(read(bad))).isInstanceOf(BusinessException.class);
	}
	@ParameterizedTest
	@ValueSource(strings={"mode", "inputSource", "pad", "startedAt", "endedAt"})
	void enumNamesAndIsoTimesCannotBeNumeric(String field) {
		String bad=PlayFixtures.free(id).replaceFirst("\""+field+"\":\"[^\"]+\"", "\""+field+"\":1");
		assertThatThrownBy(()->read(bad)).isInstanceOf(BusinessException.class);
	}
	@ParameterizedTest
	@ValueSource(strings={"1e10000", "1e-10000", "-0.01", "100.01", "50.001"})
	void accuracyIsBoundedBeforeHashing(String value) {
		String bad=PlayFixtures.scored(id,1,2).replace("\"accuracy\":50", "\"accuracy\":"+value);
		assertThatThrownBy(()->validator.structure(read(bad))).isInstanceOf(BusinessException.class);
	}
	@Test void equivalentAccuracyScaleKeepsTheSameHash() {
		var first=read(PlayFixtures.scored(id,1,2));
		var second=read(PlayFixtures.scored(id,1,2).replace("\"accuracy\":50", "\"accuracy\":50.0000"));
		validator.structure(first); validator.structure(second);
		assertThat(json.hash(7,first)).isEqualTo(json.hash(7,second));
	}
	@ParameterizedTest
	@ValueSource(strings={"0e1000000000", "0e-1000000000"})
	void zeroAccuracyIsNormalizedBeforeHashingAndDatabaseBinding(String value) {
		var p=read(PlayFixtures.scored(id,1,2).replace("\"accuracy\":50", "\"accuracy\":"+value));
		var zero=read(PlayFixtures.scored(id,1,2).replace("\"accuracy\":50", "\"accuracy\":0"));
		validator.structure(p);
		assertThat(p.summary().accuracy()).isEqualTo(java.math.BigDecimal.ZERO);
		assertThat(json.hash(7,p)).isEqualTo(json.hash(7,zero));
	}
	@Test void missesAndScoreAreValidatedAgainstFixedVersion() {
		var p=read(PlayFixtures.scored(id,1,2)); validator.structure(p); validator.notes(p,chart());
		for(String bad:new String[]{PlayFixtures.scored(id,1,2).replace("\"accuracy\":50","\"accuracy\":100"),
				PlayFixtures.scored(id,1,2).replace("\"deltaMs\":0.125","\"deltaMs\":0.1261"),
				PlayFixtures.scored(id,1,2).replace("\"matchedNoteId\":\"n2\"","\"matchedNoteId\":\"n1\""),
				PlayFixtures.scored(id,1,2).replace("\"pad\":\"KICK\"","\"pad\":\"SNARE\""),
				PlayFixtures.scored(id,1,2).replace("\"judgement\":\"MISS\"","\"velocity\":0,\"judgement\":\"MISS\"")})
			assertThatThrownBy(()->{ var b=read(bad); validator.structure(b); validator.notes(b,chart()); }).isInstanceOf(BusinessException.class);
	}
	@Test void countInAndUnmatchedHitsPreserveDecimalTime() {
		var p=read(PlayFixtures.free(id)); validator.structure(p);
		assertThat(p.hits().getFirst().tMs()).isEqualTo(-10.125);
		assertThat(p.hits().getFirst().judgement()).isNull();
	}
	@Test void publishedExamplesFollowTheActualContract() throws Exception {
		var docs=java.nio.file.Path.of("../Docs/API/examples");
		var p=read(java.nio.file.Files.readString(docs.resolve("play-summary-v1.json"))); validator.structure(p);
		var raw=new com.ssafy.airdrum.play.raw.PlayRawValidator(json);
		var result=raw.validate(new ByteArrayInputStream(PlayFixtures.gzip(java.nio.file.Files.readString(docs.resolve("play-raw-v1.json")))),p.playId(),
				java.util.Map.of(0,new PlaySessionRepository.SensorHit(0,p.hits().getFirst().tMs())));
		assertThat(result.bytes()).isPositive();
	}
	@Test void unsupportedVersionIsConflict() { assertThatThrownBy(()->validator.structure(read(PlayFixtures.free(id).replace("\"schemaVersion\":1","\"schemaVersion\":2"))))
			.isInstanceOfSatisfying(BusinessException.class,ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_SCHEMA_UNSUPPORTED)); }
	@Test void partialPlayDoesNotInventFutureMisses() {
		var p=read(PlayFixtures.scored(id,1,2).replace(",\n{",",{"));
		var tree=(tools.jackson.databind.node.ObjectNode)json.mapper().readTree(json.write(p));
		((tools.jackson.databind.node.ArrayNode)tree.get("hits")).remove(1);
		((tools.jackson.databind.node.ObjectNode)tree.get("summary").get("judgementCounts")).put("miss",0);
		var partial=read(tree.toString()); validator.structure(partial); validator.notes(partial,chart());
		assertThat(partial.hits()).hasSize(1);
	}
	@Test void actualBytesDepthAndDurationAreBounded() {
		assertThatThrownBy(()->json.read(new ByteArrayInputStream(new byte[PlayJson.SUMMARY_BYTES+1])))
				.isInstanceOfSatisfying(BusinessException.class,ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE));
		assertThatThrownBy(()->validator.structure(read(PlayFixtures.free(id).replace("00:01:00Z","03:01:00Z"))))
				.isInstanceOfSatisfying(BusinessException.class,ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE));
		assertThatThrownBy(()->read("[".repeat(30)+"]".repeat(30))).isInstanceOf(BusinessException.class);
	}
	static PlaySessionRepository.ChartData chart() { return new PlaySessionRepository.ChartData("[{\"noteId\":\"n1\",\"timeMs\":100,\"pad\":\"SNARE\"},{\"noteId\":\"n2\",\"timeMs\":200,\"pad\":\"KICK\"}]",2,1,"1","1"); }
}
