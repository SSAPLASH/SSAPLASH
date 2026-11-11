package com.ssafy.airdrum.domain.song.service.musicxml;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.domain.song.exception.MusicXmlErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 293 설계 1장: 확장자·Content-Type을 믿지 않고 실제 바이트로 MusicXML(XML)·mxl(zip)을 가른다. */
public class MusicXmlSnifferTest {

	static final String PARTWISE = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE score-partwise PUBLIC \"-//Recordare//DTD MusicXML 4.0 Partwise//EN\" \"http://www.musicxml.org/dtds/partwise.dtd\">\n<score-partwise version=\"4.0\"><part-list/></score-partwise>";

	public static byte[] mxl(String rootfile, String xml) throws Exception {
		var out = new ByteArrayOutputStream();
		try (var zip = new ZipOutputStream(out)) {
			zip.putNextEntry(new ZipEntry("META-INF/container.xml"));
			zip.write(("<?xml version=\"1.0\"?><container><rootfiles><rootfile full-path=\"" + rootfile + "\"/></rootfiles></container>").getBytes(StandardCharsets.UTF_8));
			zip.closeEntry();
			zip.putNextEntry(new ZipEntry(rootfile));
			zip.write(xml.getBytes(StandardCharsets.UTF_8));
			zip.closeEntry();
		}
		return out.toByteArray();
	}

	@Test
	void XML과_mxl을_바이트로_알아보고_AI에_보낼_이름을_정한다() throws Exception {
		assertThat(MusicXmlSniffer.sniff(PARTWISE.getBytes(StandardCharsets.UTF_8))).isEqualTo(MusicXmlSniffer.Kind.XML);
		assertThat(MusicXmlSniffer.Kind.XML.fileName()).isEqualTo("score.musicxml");
		// BOM·선언 없는 XML·timewise도 MusicXML로 본다(timewise 거절은 AI가 한다)
		assertThat(MusicXmlSniffer.sniff(("﻿" + PARTWISE).getBytes(StandardCharsets.UTF_8))).isEqualTo(MusicXmlSniffer.Kind.XML);
		assertThat(MusicXmlSniffer.sniff("  <score-partwise><part-list/></score-partwise>".getBytes(StandardCharsets.UTF_8))).isEqualTo(MusicXmlSniffer.Kind.XML);
		assertThat(MusicXmlSniffer.sniff("<?xml version=\"1.0\"?><score-timewise/>".getBytes(StandardCharsets.UTF_8))).isEqualTo(MusicXmlSniffer.Kind.XML);
		assertThat(MusicXmlSniffer.sniff(mxl("score.xml", PARTWISE))).isEqualTo(MusicXmlSniffer.Kind.MXL);
		assertThat(MusicXmlSniffer.Kind.MXL.fileName()).isEqualTo("score.mxl");
	}

	@Test
	void 빈_파일은_INVALID이고_다른_형식은_UNSUPPORTED다() throws Exception {
		assertThatThrownBy(() -> MusicXmlSniffer.sniff(new byte[0])).isInstanceOfSatisfying(BusinessException.class,
				ex -> assertThat(ex.getErrorCode()).isEqualTo(MusicXmlErrorCode.INVALID));
		for (byte[] bad : new byte[][] {
				"%PDF-1.7 ...".getBytes(StandardCharsets.UTF_8),
				"MThd\0\0\0\u0006".getBytes(StandardCharsets.ISO_8859_1),
				"<?xml version=\"1.0\"?><html><body/></html>".getBytes(StandardCharsets.UTF_8),
				"PK\u0003\u0004 zip without container".getBytes(StandardCharsets.ISO_8859_1),
				zipWithout("other.xml"),
				new byte[] {(byte) 0x89, 'P', 'N', 'G'},
				("<!-- " + "x".repeat(5000) + " --><score-partwise/>").getBytes(StandardCharsets.UTF_8)}) {
			assertThatThrownBy(() -> MusicXmlSniffer.sniff(bad)).as(new String(bad, 0, Math.min(16, bad.length), StandardCharsets.ISO_8859_1))
					.isInstanceOfSatisfying(BusinessException.class, ex -> assertThat(ex.getErrorCode()).isEqualTo(MusicXmlErrorCode.UNSUPPORTED));
		}
	}

	@Test
	void 오류_코드는_MUSICXML_접두어와_상태를_가진다() {
		assertThat(MusicXmlErrorCode.INVALID.code()).isEqualTo("MUSICXML_INVALID");
		assertThat(MusicXmlErrorCode.TOO_LARGE.status().value()).isEqualTo(413);
		assertThat(MusicXmlErrorCode.UNSUPPORTED.status().value()).isEqualTo(422);
		assertThat(MusicXmlErrorCode.NO_DRUM_NOTES.status().value()).isEqualTo(422);
		assertThat(MusicXmlErrorCode.UNAVAILABLE.status().value()).isEqualTo(503);
	}

	static byte[] zipWithout(String entry) throws Exception {
		var out = new ByteArrayOutputStream();
		try (var zip = new ZipOutputStream(out)) {
			zip.putNextEntry(new ZipEntry(entry));
			zip.write("<score-partwise/>".getBytes(StandardCharsets.UTF_8));
			zip.closeEntry();
		}
		return out.toByteArray();
	}
}
