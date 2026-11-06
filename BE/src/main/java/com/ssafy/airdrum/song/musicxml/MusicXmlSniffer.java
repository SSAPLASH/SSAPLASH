package com.ssafy.airdrum.song.musicxml;

import java.nio.charset.StandardCharsets;

import com.ssafy.airdrum.common.error.BusinessException;

/**
 * 올라온 바이트가 MusicXML인지 본다(293번 설계 1장). 확장자·Content-Type은 믿지 않는다(음원·커버·악보 보관과 같은 규칙).
 *
 * <ul>
 * <li>XML: BOM·공백 뒤 {@code <}로 시작하고 앞 4 KiB 안에 {@code <score-partwise} 또는 {@code <score-timewise}가 있다. timewise 거절은 AI가 한다.</li>
 * <li>mxl: zip 머리 {@code PK\u0003\u0004}로 시작하고 {@code META-INF/container.xml} 항목 이름이 있다.</li>
 * </ul>
 * 악보 해석은 하지 않는다(AI {@code parse_musicxml}). 여기서 가른 종류로 AI에 보낼 파일 이름(확장자)을 정한다.
 */
public final class MusicXmlSniffer {

	public static final int MAX_BYTES = 5 * 1024 * 1024;
	private static final int HEAD_BYTES = 4096;
	private static final byte[] CONTAINER = "META-INF/container.xml".getBytes(StandardCharsets.US_ASCII);

	public enum Kind {
		XML("score.musicxml"), MXL("score.mxl");

		private final String fileName;

		Kind(String fileName) {
			this.fileName = fileName;
		}

		/** AI {@code POST /chart/sheet?name=}에 보내는 이름. 사용자 파일 이름은 쓰지 않는다. */
		public String fileName() {
			return fileName;
		}
	}

	private MusicXmlSniffer() {
	}

	/** 빈 파일은 {@code MUSICXML_INVALID}, 알아볼 수 없는 바이트는 {@code MUSICXML_UNSUPPORTED}. */
	public static Kind sniff(byte[] bytes) {
		if (bytes.length == 0) throw new BusinessException(MusicXmlErrorCode.INVALID);
		if (bytes.length >= 4 && bytes[0] == 'P' && bytes[1] == 'K' && bytes[2] == 3 && bytes[3] == 4) {
			if (indexOf(bytes, CONTAINER) >= 0) return Kind.MXL;
			throw new BusinessException(MusicXmlErrorCode.UNSUPPORTED, "MusicXML 압축 파일(.mxl)이 아닙니다.");
		}
		int start = 0;
		if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) start = 3;
		while (start < bytes.length && Character.isWhitespace(bytes[start])) start++;
		if (start >= bytes.length || bytes[start] != '<') throw new BusinessException(MusicXmlErrorCode.UNSUPPORTED, "MusicXML 파일이 아닙니다.");
		String head = new String(bytes, start, Math.min(HEAD_BYTES, bytes.length - start), StandardCharsets.ISO_8859_1);
		if (head.contains("<score-partwise") || head.contains("<score-timewise")) return Kind.XML;
		throw new BusinessException(MusicXmlErrorCode.UNSUPPORTED, "MusicXML 악보(score-partwise)가 아닙니다.");
	}

	private static int indexOf(byte[] haystack, byte[] needle) {
		outer:
		for (int i = 0; i + needle.length <= haystack.length; i++) {
			for (int j = 0; j < needle.length; j++) if (haystack[i + j] != needle[j]) continue outer;
			return i;
		}
		return -1;
	}

}
