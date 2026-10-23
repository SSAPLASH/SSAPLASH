package com.ssafy.airdrum.play.raw;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.util.zip.CRC32;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/** 단일 gzip member만 읽는다. 표준 GZIPInputStream의 연결 member·후행 바이트 허용을 피한다. */
final class SingleMemberGzipInputStream extends InputStream {
	private final PushbackInputStream input;
	private final Inflater inflater = new Inflater(true);
	private final CRC32 crc = new CRC32();
	private final byte[] compressed = new byte[8192];
	private long count;
	private int lastLength;
	private boolean ended;
	SingleMemberGzipInputStream(InputStream input) throws IOException {
		this.input = new PushbackInputStream(input, compressed.length);
		try { header(); } catch (IOException | RuntimeException ex) { inflater.end(); this.input.close(); throw ex; }
	}
	private void header() throws IOException {
		CRC32 headerCrc = new CRC32();
		int[] h = new int[10];
		for (int i=0;i<10;i++) { h[i]=required(); headerCrc.update(h[i]); }
		if (h[0]!=31 || h[1]!=139 || h[2]!=8 || (h[3]&224)!=0) throw invalid();
		if ((h[3]&4)!=0) {
			int lo=required(), hi=required(); headerCrc.update(lo); headerCrc.update(hi);
			for (int i=0;i<(lo|(hi<<8));i++) headerCrc.update(required());
		}
		for (int flag : new int[]{8,16}) if ((h[3]&flag)!=0) {
			int length=0, b;
			do { b=required(); headerCrc.update(b); if (++length>65536) throw invalid(); } while(b!=0);
		}
		if ((h[3]&2)!=0 && ((required()|(required()<<8))!=(headerCrc.getValue()&65535))) throw invalid();
	}
	@Override public int read() throws IOException { byte[] b=new byte[1]; return read(b,0,1)<0 ? -1 : b[0]&255; }
	@Override public int read(byte[] b,int off,int len) throws IOException {
		java.util.Objects.checkFromIndexSize(off,len,b.length);
		if (len==0) return 0; if (ended) return -1;
		try {
			while (true) {
				int n=inflater.inflate(b,off,len);
				if(n>0) { crc.update(b,off,n); count+=n; return n; }
				if(inflater.finished()) { trailer(); ended=true; return -1; }
				if(inflater.needsDictionary()) throw invalid();
				if(inflater.needsInput()) {
					lastLength=input.read(compressed); if(lastLength<0) throw invalid();
					inflater.setInput(compressed,0,lastLength);
				} else throw invalid();
			}
		} catch (DataFormatException ex) { throw invalid(); }
	}
	private void trailer() throws IOException {
		int remaining=inflater.getRemaining();
		if(remaining>0) input.unread(compressed,lastLength-remaining,remaining);
		if(little32()!=crc.getValue() || little32()!=(count&0xffffffffL) || input.read()!=-1) throw invalid();
	}
	private long little32() throws IOException { long v=0; for(int i=0;i<4;i++) v|=(long)required()<<(8*i); return v; }
	private int required() throws IOException { int b=input.read(); if(b<0) throw invalid(); return b; }
	private static IOException invalid() { return new IOException("gzip 원본이 올바르지 않습니다."); }
	@Override public void close() throws IOException { inflater.end(); input.close(); }
}
