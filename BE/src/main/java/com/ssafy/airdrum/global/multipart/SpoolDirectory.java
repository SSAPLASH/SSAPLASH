package com.ssafy.airdrum.global.multipart;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import org.slf4j.LoggerFactory;

public final class SpoolDirectory implements AutoCloseable {
	final Path root,directory;
	public Path path() { return directory; }
	private final FileChannel channel;
	private final FileLock lock;
	SpoolDirectory(Path base) throws IOException {
		Files.createDirectories(base); root=base.toRealPath();
		try(var startup=FileChannel.open(root.resolve("startup.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);
				var startupLock=startup.lock()) {
		// 같은 장비의 실행 중인 다른 인스턴스는 파일 잠금으로 보호한다.
		try(var children=Files.newDirectoryStream(root)) {
			for(Path candidate:children) {
				if(!candidate.getFileName().toString().matches("[0-9a-f-]{36}") || !Files.isDirectory(candidate,LinkOption.NOFOLLOW_LINKS)
						|| !Files.isRegularFile(candidate.resolve("owner.lock"),LinkOption.NOFOLLOW_LINKS)) continue;
				try(var old=FileChannel.open(candidate.resolve("owner.lock"),StandardOpenOption.WRITE)) {
					try(var claimed=old.tryLock()) { if(claimed==null) continue; cleanFiles(candidate,false); }
				} catch(OverlappingFileLockException ex) { continue; }
				catch(IOException ex) { continue; }
				try { Files.deleteIfExists(candidate.resolve("owner.lock")); Files.deleteIfExists(candidate); }
				catch(IOException ex) { LoggerFactory.getLogger(SpoolDirectory.class).warn("이전 원본 업로드 임시 파일 정리가 지연되었습니다."); }
			}
		}
		directory=Files.createDirectory(root.resolve(UUID.randomUUID().toString()));
		channel=FileChannel.open(directory.resolve("owner.lock"),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);
		lock=channel.lock();
		}
	}
	private void cleanFiles(Path target,boolean includeOwner) throws IOException {
		Path normalized=target.toAbsolutePath().normalize();
		if(!normalized.startsWith(root) || !root.equals(normalized.getParent()) || Files.isSymbolicLink(target)) throw new IOException("임시 파일 경계 오류");
		try(var files=Files.newDirectoryStream(target)) {
			for(Path file:files) if((includeOwner || !file.getFileName().toString().equals("owner.lock")) && !Files.isDirectory(file,LinkOption.NOFOLLOW_LINKS)) Files.deleteIfExists(file);
		}
	}
	public void close() throws IOException {
		try(var startup=FileChannel.open(root.resolve("startup.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);
				var startupLock=startup.lock()) {
			lock.release(); channel.close(); cleanFiles(directory,true); Files.deleteIfExists(directory);
		}
	}
}
