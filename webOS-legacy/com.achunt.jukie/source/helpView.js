/*globals enyo, $L */
/*
 * kindHelpView - the full-screen Help scene, shown by swapping the paneTop view (same
 * mechanism as Preferences/kindSettingsView). Built on listViewDraggable for the same
 * native chrome (ctrlListViewHeader bar, `.list` body, footer action bar).
 *
 * Sections use plain styled Controls (.jukieBoxSection/.jukieBoxSectionCaption, shared with
 * Settings - see jukie-theme.css), not enyo.RowGroup: compared on-device against the stock
 * Sounds & Ringtones app (a real reference for a properly-grouped box), RowGroup's native
 * border-image renders far too faint here - just a flat label bar, no clearly visible box,
 * especially on the bottom edge - so both this view and Settings draw their own box instead.
 *
 * webOS's own AppMenu HelpMenu kind only makes sense for HP/Palm's own apps (a palm.com
 * target opens the on-device Help app; anything else just opens the web browser instead) -
 * there's no manifest hook or content-registration API for a 3rd-party app to plug into the
 * system Help app. So this is Jukie's own self-contained help, not a system integration.
 *
 * Emits onCloseHelp; app.js slides paneTop back to the main view.
 */
enyo.kind({
	name: "kindHelpView",
	kind: "listViewDraggable",
	className: "view jukieSettingsView jukieHelpView",
	height: "100%",
	events: {onCloseHelp: ""},

	components: [
		{name: "header", kind: "ctrlListViewHeader", strHeaderTitle: $L("Help"), boolShowSearchBtn: false},
		{name: "content", kind: "Control", layoutKind: "VFlexLayout", className: "list", flex: 1, components: [
			{name: "scroller", kind: "Scroller", flex: 1, components: [
				{className: "jukieSettingsList", components: [
					{className: "jukieBoxSection", components: [
						{content: $L("About Jukie"), className: "jukieBoxSectionCaption"},
						{className: "jukieHelpParagraph", content: $L(
							"Jukie is an unofficial Apple Music client for the Palm/HP TouchPad and Pre 3 " +
							"(webOS 2–3, 2011–2012). It reuses the look of the original Palm Music " +
							"app, but pulls its catalog, library, and playback from Apple Music instead of " +
							"the on-device media database — including full-track playback, real " +
							"seeking, and offline caching, not just 30-second previews."
						)}
					]},
					{className: "jukieBoxSection", components: [
						{content: $L("Getting your Apple Music tokens"), className: "jukieBoxSectionCaption"},
						{className: "jukieHelpParagraph", content: $L(
							"Jukie needs a Developer Token to talk to Apple's Music catalog API. The " +
							"proper way to get one is an Apple Developer Program membership: create a " +
							"MusicKit identifier and private key under Certificates, Identifiers & " +
							"Profiles, then sign a JWT (ES256) with your Team ID and Key ID — valid " +
							"up to 6 months. If you'd rather not set that up, music.apple.com's own web " +
							"player uses a short-lived public token you can copy from your browser's " +
							"network inspector (look for the Authorization: Bearer header on " +
							"api.music.apple.com requests) — it expires roughly monthly, so it'll " +
							"need refreshing occasionally. Paste whichever one you use into " +
							"Settings → Developer Token."
						)},
						{className: "jukieHelpParagraph", content: $L(
							"The Music User Token identifies your personal Apple Music library and " +
							"subscription. Sign in to music.apple.com in a desktop browser with your " +
							"Apple ID, open your browser's developer tools, and look for the " +
							"media-user-token cookie (or the Music-User-Token header on API requests) " +
							"— copy that value into Settings → Music User Token. It's " +
							"long-lived (months), so this is usually a one-time paste."
						)}
					]},
					{className: "jukieBoxSection", components: [
						{content: $L("Full-track playback"), className: "jukieBoxSectionCaption"},
						{className: "jukieHelpParagraph", content: $L(
							"Beyond Apple's 30-second previews, full-track playback requires decrypting " +
							"Apple's Widevine-protected stream, which needs a Widevine L3 device " +
							"certificate. Setting one up is outside the scope of this screen. Without " +
							"one, Jukie still works great for browsing your library and catalog and " +
							"playing previews."
						)}
					]},
					{className: "jukieBoxSection", components: [
						{content: $L("Thanks"), className: "jukieBoxSectionCaption"},
						{className: "jukieHelpParagraph", content: $L(
							"Huge thanks to the webOS Archive Team, whose TLS upgrade for this device's " +
							"system libraries is the only reason any of this — reaching Apple's " +
							"modern HTTPS-only servers at all — was possible."
						)}
					]}
				]}
			]}
		]},
		{kind: "Toolbar", className: "enyo-toolbar-light jukieSettingsFooter", layoutKind: "HFlexLayout", pack: "justify", align: "center", components: [
			{kind: "Button", caption: $L("Back"), className: "enyo-button-affirmative", onclick: "onclick_Back"}
		]}
	],

	ready: function () {
		this.inherited(arguments);
		this.$.header.setStrHeaderTitle($L("Help"));
	},

	onclick_Back: function () {
		this.doCloseHelp();
	}
});
