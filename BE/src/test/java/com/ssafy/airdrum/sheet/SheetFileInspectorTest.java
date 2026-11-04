package com.ssafy.airdrum.sheet;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.common.error.BusinessException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 155번 설계 1절 상한 표·4절 검사: 실제 바이트로 형식·완결성·크기를 확인한다. */
class SheetFileInspectorTest {

	final SheetFileInspector inspector = new SheetFileInspector();
	final java.util.List<Path> files = new java.util.ArrayList<>();

	@AfterEach
	void clean() throws Exception {
		for (Path p : files) Files.deleteIfExists(p);
	}

	@Test
	void 정상_이미지와_PDF는_형식과_크기를_돌려준다() throws Exception {
		var png = inspector.inspect(file(image("png", 800, 1200)));
		assertThat(png).isEqualTo(new SheetFileInspector.Inspected(SheetFileInspector.Kind.IMAGE, "png", "image/png", 800, 1200));
		var jpg = inspector.inspect(file(image("jpg", 640, 480)));
		assertThat(jpg.extension()).isEqualTo("jpg");
		assertThat(jpg.contentType()).isEqualTo("image/jpeg");
		var webp = inspector.inspect(file(Base64.getDecoder().decode("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA")));
		assertThat(webp.contentType()).isEqualTo("image/webp");
		var pdf = inspector.inspect(file(pdf()));
		assertThat(pdf).isEqualTo(new SheetFileInspector.Inspected(SheetFileInspector.Kind.PDF, "pdf", "application/pdf", null, null));
	}

	@Test
	void 큰_사진은_줄여서_읽어도_통과한다() throws Exception {
		var big = inspector.inspect(file(image("jpg", 4000, 3000)));
		assertThat(big.width()).isEqualTo(4000);
		assertThat(big.height()).isEqualTo(3000);
		assertThat(SheetFileInspector.subsampling(4000, 3000)).isEqualTo(2);
		assertThat(SheetFileInspector.subsampling(8000, 5000)).isEqualTo(4);
		assertThat(SheetFileInspector.subsampling(2000, 2000)).isEqualTo(1);
	}

	@Test
	void 깨지거나_가짜인_파일은_SHEET_INVALID() throws Exception {
		byte[] png = image("png", 300, 300);
		expect(new byte[0], "SHEET_INVALID");
		expect(Arrays.copyOf(png, png.length - 20), "SHEET_INVALID");
		byte[] jpg = image("jpg", 300, 300);
		expect(Arrays.copyOf(jpg, jpg.length - 10), "SHEET_INVALID");
		expect("%PDF-1.4 잘린 파일".getBytes(StandardCharsets.UTF_8), "SHEET_INVALID");
		expect("%%EOF 머리 없음".getBytes(StandardCharsets.UTF_8), "SHEET_UNSUPPORTED");
	}

	@Test
	void 지원하지_않는_형식은_SHEET_UNSUPPORTED() throws Exception {
		expect(image("gif", 10, 10), "SHEET_UNSUPPORTED");
		expect(image("bmp", 10, 10), "SHEET_UNSUPPORTED");
		expect("그냥 텍스트".getBytes(StandardCharsets.UTF_8), "SHEET_UNSUPPORTED");
	}

	@Test
	void 크기와_화소_상한을_넘으면_거절한다() throws Exception {
		expect(image("png", 8001, 1), "SHEET_INVALID");
		expect(image("png", 1, 8001), "SHEET_INVALID");
		byte[] tooBigImage = Arrays.copyOf(image("png", 10, 10), SheetFileInspector.MAX_IMAGE_BYTES + 1);
		expect(tooBigImage, "SHEET_TOO_LARGE");
		byte[] tooBigPdf = new byte[SheetFileInspector.MAX_PDF_BYTES + 1];
		System.arraycopy("%PDF-1.4".getBytes(StandardCharsets.US_ASCII), 0, tooBigPdf, 0, 8);
		expect(tooBigPdf, "SHEET_TOO_LARGE");
		assertThat(SheetFileInspector.MAX_IMAGE_BYTES).isEqualTo(10 * 1024 * 1024);
		assertThat(SheetFileInspector.MAX_PDF_BYTES).isEqualTo(20 * 1024 * 1024);
	}

	private void expect(byte[] bytes, String code) throws Exception {
		Path p = file(bytes);
		assertThatThrownBy(() -> inspector.inspect(p))
				.isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode().code()).isEqualTo(code));
	}

	private Path file(byte[] bytes) throws Exception {
		Path p = Files.createTempFile("sheet-inspect-", ".bin");
		Files.write(p, bytes);
		files.add(p);
		return p;
	}

	private static byte[] image(String format, int w, int h) throws Exception {
		var img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
		img.setRGB(0, 0, 0xFFFFFF);
		var out = new ByteArrayOutputStream();
		if (!ImageIO.write(img, format, out)) throw new IllegalStateException(format);
		return out.toByteArray();
	}

	private static byte[] pdf() {
		return ("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n").getBytes(StandardCharsets.US_ASCII);
	}
}
