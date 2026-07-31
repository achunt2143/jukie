# Jukie — webOS Apple Music Client

This is a **Palm/HP webOS** application (original 2009–2012 platform, not LG webOS).

## Session Setup

At the start of every session, load the full webOS platform context:

```
webos://knowledge/all
```

This gives you knowledge of the Mojo/Enyo frameworks, Luna service bus, SDK tools (including novacom), app structure conventions, and common gotchas — so we don't have to re-establish basics each time.

## Local SDK reference (PREFER over probing the device)

The HP webOS SDK is installed locally at:

```
C:\Program Files (x86)\HP webOS\SDK\share
```

- Enyo 1 framework source (the same generation the device runs as "0.10"):
  `…\SDK\share\framework\enyo\1.0\framework\source\` — read these for real kind APIs
  (published props, events, methods) instead of grepping the minified build on-device.
- Sample apps: `…\SDK\share\samplecode\`, docs: `…\SDK\share\documentation\`.