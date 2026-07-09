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
      <Header>Settings</Header>
      <Divider />

      <Subheader content="Appearance" />
      <Item
        title="Dark mode"
        rightContent={
          <Toggle
            checked={theme === 'dark'}
            onChange={() => toggleTheme()}
          />
        }
      />

      <Divider />
      <Subheader content="Playback" />
      <Item title="Streaming quality" rightContent={
        <Dropdown options={qualityOptions} value={quality} onChange={setQuality} />
      } />
      <Item title="Crossfade" rightContent={
        <Toggle checked={crossfade} onChange={(e) => setCrossfade(e.target.checked)} />
      } />

      <Divider />
      <Subheader content="Notifications" />
      <Item title="Show now-playing notifications" rightContent={
        <Toggle checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />
      } />

      <Divider />
      <Subheader content="About" />
      <Item title="Version" rightContent="0.1.0" />
      <Item title="Platform" rightContent="Remochi (Web)" />
    </div>
  );
}
