package com.ssafy.airdrum.song;

import java.io.ByteArrayInputStream;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.common.error.BusinessException;

@Component
class CoverImage {
    static final int MAX_BYTES=2*1024*1024;
    record Image(byte[] bytes,String extension,String contentType) {}
    Image decode(byte[] data) {
        if(data.length==0) throw new BusinessException(SongManagementError.COVER_INVALID);
        if(data.length>MAX_BYTES) throw new BusinessException(SongManagementError.COVER_TOO_LARGE);
        try(var input=new MemoryCacheImageInputStream(new ByteArrayInputStream(data))) {
            var readers=ImageIO.getImageReaders(input);
            if(!readers.hasNext()) throw new BusinessException(SongManagementError.COVER_INVALID);
            var reader=readers.next();
            try {
                String format=reader.getFormatName().toLowerCase(java.util.Locale.ROOT);
                String extension=switch(format) { case "jpeg","jpg" -> "jpg"; case "png" -> "png"; case "webp" -> "webp"; default -> throw new BusinessException(SongManagementError.COVER_UNSUPPORTED); };
                if(!complete(data,extension)) throw new BusinessException(SongManagementError.COVER_INVALID);
                var warning=new java.util.concurrent.atomic.AtomicBoolean();
                reader.addIIOReadWarningListener((source,message)->warning.set(true));
                reader.setInput(input,true,true);
                int width=reader.getWidth(0),height=reader.getHeight(0);
                if(width<1 || height<1 || width>4096 || height>4096 || (long)width*height>4_000_000) throw new BusinessException(SongManagementError.COVER_INVALID);
                if(reader.read(0)==null || warning.get()) throw new BusinessException(SongManagementError.COVER_INVALID);
                return new Image(data,extension,extension.equals("jpg")?"image/jpeg":"image/"+extension);
            } finally { reader.dispose(); }
        } catch(BusinessException ex) { throw ex; }
        catch(Exception ex) { throw new BusinessException(SongManagementError.COVER_INVALID); }
    }
    private boolean complete(byte[] bytes,String format) {
        int n=bytes.length;
        if(format.equals("jpg")) return n>=4 && (bytes[0]&255)==255 && (bytes[1]&255)==216 && (bytes[n-2]&255)==255 && (bytes[n-1]&255)==217;
        if(format.equals("png")) return n>=20 && bytes[n-12]==0 && bytes[n-11]==0 && bytes[n-10]==0 && bytes[n-9]==0
                && bytes[n-8]=='I' && bytes[n-7]=='E' && bytes[n-6]=='N' && bytes[n-5]=='D';
        if(n<12 || bytes[0]!='R' || bytes[1]!='I' || bytes[2]!='F' || bytes[3]!='F' || bytes[8]!='W' || bytes[9]!='E' || bytes[10]!='B' || bytes[11]!='P') return false;
        long size=(bytes[4]&255L)|((bytes[5]&255L)<<8)|((bytes[6]&255L)<<16)|((bytes[7]&255L)<<24);
        return size+8==n;
    }
}
