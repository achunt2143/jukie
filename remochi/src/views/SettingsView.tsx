import React, { useState } from 'react';
import { Header, Subheader, Divider, Toggle, Dropdown, Item, useTheme } from 'remochi';

const qualityOptions = [
  { label: 'High (256 kbps AAC)', value: 'high' },
  { label: 'Standard (128 kbps AAC)', value: 'standard' },
  { label: 'Low (64 kbps AAC)', value: 'low' },
];

export default function SettingsView() {
  const { theme, toggleTheme } = useTheme();
  const [quality, setQuality] = useState('high');
  const [notifications, setNotifications] = useState(true);
  const [crossfade, setCrossfade] = useState(false);

  return (
    <div>
      <Header content='Settings' />

      <div style={{ marginBottom: 8 }} />
      <Divider />

      <Subheader content="Appearance" />
      <div style={{ marginBottom: 8 }} />
      <div style={{ margin: "0px 24px" }}>
        <Item
          title="Dark mode"
          rightContent={
            <Toggle
              checked={theme === 'dark'}
              onChange={() => toggleTheme()}
            />
          }
        />
        <div style={{ marginBottom: 16 }} />
        <Divider />
      </div>

      <Subheader content="Playback" />
      <div style={{ marginBottom: 8 }} />
      <div style={{ margin: "0px 24px" }}>
        <Item title="Streaming quality" rightContent={
          <Dropdown options={qualityOptions} value={quality} onChange={setQuality} />
        } />
        <div style={{ marginBottom: 4 }} />
        <Item title="Crossfade" rightContent={
          <Toggle checked={crossfade} onChange={(e) => setCrossfade(e.target.checked)} />
        } />
        <div style={{ marginBottom: 16 }} />
        <Divider />
      </div>

      <Subheader content="Notifications" />
      <div style={{ marginBottom: 8 }} />
      <div style={{ margin: "0px 24px" }}>
        <Item title="Show now-playing notifications" rightContent={
          <Toggle checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />
        } />
        <div style={{ marginBottom: 16 }} />
        <Divider />
      </div>
      <Subheader content="About" />
      <div style={{ marginBottom: 8 }} />
      <div style={{ margin: "0px 24px" }}>
        <Item title="Version" rightContent="0.1.0" />
        <div style={{ marginBottom: 4 }} />
        <Item title="Platform" rightContent="Remochi (Web) 0.2.1" />
      </div>
    </div>
  );
}
