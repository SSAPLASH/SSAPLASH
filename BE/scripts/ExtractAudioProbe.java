import java.io.BufferedInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import org.tukaani.xz.XZInputStream;

/** CI에서 시스템 xz 설치 없이 검증된 보관 파일을 압축 해제한다. */
class ExtractAudioProbe {
    public static void main(String[] args) throws Exception {
        try (var input = new XZInputStream(new BufferedInputStream(Files.newInputStream(Path.of(args[0]))));
                var output = Files.newOutputStream(Path.of(args[1]), StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
            input.transferTo(output);
        }
    }
}
