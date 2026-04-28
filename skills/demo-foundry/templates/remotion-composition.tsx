import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export type DemoCompositionProps = {
  title: string;
  screenshotSrc: string;
  caption?: string;
};

export function DemoComposition({ title, screenshotSrc, caption }: DemoCompositionProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.04]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0f19', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <AbsoluteFill style={{ padding: 56 }}>
        <div style={{ color: 'white', fontSize: 42, fontWeight: 700, marginBottom: 24 }}>{title}</div>
        <div style={{ borderRadius: 24, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>
          <Img src={screenshotSrc} style={{ width: '100%', transform: `scale(${scale})`, transformOrigin: 'center top' }} />
        </div>
        {caption ? (
          <div style={{ color: 'white', fontSize: 28, marginTop: 28, maxWidth: 1100 }}>{caption}</div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
