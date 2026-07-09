import React, { useState } from 'react';
import { Header, Input, Divider, Spinner, List, ListItem, Subheader } from 'remochi';
import type { SearchResults } from '@/types/music';
import { search } from '@/api';
import TrackList from '@/components/TrackList';

export default function SearchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(q: string) {
    setQuery(q);
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    const r = await search(q);
    setResults(r);
    setLoading(false);
  }

  return (
    <div>
      <Header>Search</Header>
      <Input
        type="search"
        placeholder="Search Apple Music…"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        style={{ width: '100%', marginBottom: 12 }}
      />
      <Divider />
      {loading && <Spinner active styleType="dark" size="normal" />}
      {results && !loading && (
        <>
          {results.artists.length > 0 && (
            <><Subheader content="Artists" />
              <List>{results.artists.map((a) => <ListItem key={a.id}>{a.name}</ListItem>)}</List>
            </>
          )}
          {results.albums.length > 0 && (
            <><Subheader content="Albums" />
              <List>{results.albums.map((a) => <ListItem key={a.id}>{a.title} — {a.artist}</ListItem>)}</List>
            </>
          )}
          {results.tracks.length > 0 && (
            <><Subheader content="Songs" /><TrackList tracks={results.tracks} /></>
          )}
          {!results.tracks.length && !results.albums.length && !results.artists.length && (
            <p style={{ opacity: 0.5 }}>No results for "{query}"</p>
          )}
        </>
      )}
    </div>
  );
}
