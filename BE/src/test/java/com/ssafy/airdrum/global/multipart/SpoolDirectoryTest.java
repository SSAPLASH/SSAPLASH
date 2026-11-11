package com.ssafy.airdrum.global.multipart;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SpoolDirectoryTest {
    @TempDir Path temp;
    @Test void startupOnlyCleansOwnedInactiveSpoolDirectories() throws Exception {
        Path abandoned=Files.createDirectories(temp.resolve(UUID.randomUUID().toString()));
        Files.createFile(abandoned.resolve("owner.lock")); Files.writeString(abandoned.resolve("upload_old.tmp"),"old");
        Path unrelated=Files.createDirectories(temp.resolve("unrelated")); Files.writeString(unrelated.resolve("keep.txt"),"keep");
        try(var first=new SpoolDirectory(temp)) {
            Files.writeString(first.path().resolve("upload_active.tmp"),"active");
            try(var second=new SpoolDirectory(temp)) {
                assertThat(abandoned).doesNotExist(); assertThat(first.path().resolve("upload_active.tmp")).exists();
                assertThat(unrelated.resolve("keep.txt")).exists(); assertThat(second.path()).exists();
            }
        }
    }
}
