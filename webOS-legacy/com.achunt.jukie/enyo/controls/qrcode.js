/*
	A control that draws a QR code, backed by lib/QrCodeLib.js.

	That library takes a real DOM node and paints into it directly - it has
	no "give me markup" mode - so this exists to bridge its imperative API to
	Enyo's declarative one: draw once the node actually exists (rendered(),
	not create() - matches the same $-hash timing rule everything else in
	this app follows), and redraw in place whenever `text` changes rather
	than tearing down and rebuilding the control.
*/
enyo.kind({
	name: "QrCode",
	kind: enyo.Control,
	className: "jukie-qrcode",

	published: {
		text: "",
		size: 220
	},

	//* @protected
	qr: null,

	rendered: function () {
		this.inherited(arguments);
		this.draw();
	},

	textChanged: function () {
		this.draw();
	},

	draw: function () {
		// Nothing to draw before the node exists, or with nothing to encode
		// - the library errors on an empty string rather than no-op-ing.
		if (!this.hasNode() || !this.text) return;

		if (this.qr) {
			this.qr.clear();
			this.qr.makeCode(this.text);
			return;
		}

		this.qr = new window.QRCode(this.hasNode(), {
			text: this.text,
			width: this.size,
			height: this.size,
			correctLevel: window.QRCode.CorrectLevel.M
		});
	}
});
