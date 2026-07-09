import React, { useRef } from 'react';
import { Header, Spinner, Divider } from 'remochi';
import { useLibrary } from '@/store/LibraryStore';
import TrackList from '@/components/TrackList';
import AlphaScroller from '@/components/AlphaScroller';

export default function SongsView() {
  const { tracks, loading } = useLibrary();
  const refs = useRef<Record<string, HTMLElement | null>>({});

  const sorted = [...tracks].sort((a, b) => a.title.localeCompare(b.title));

  function scrollTo(letter: string) {
    const el = refs.current[letter];
    el?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div style={{ position: 'relative' }}>
      <Header>Songs</Header>
      <Divider />
      {loading ? <Spinner active styleType="dark" size="normal" /> : <TrackList tracks={sorted} />}
      <AlphaScroller onSelect={scrollTo} />
    </div>
  );
}
