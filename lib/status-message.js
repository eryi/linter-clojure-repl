"use babel";

// Based on https://github.com/lee-dohm/package-sync/blob/master/lib/status-message.coffee
// Public: Displays a message in the status bar.
export default class StatusMessage {
  // Public: Displays `message` in the status bar.
  //
  // If the status bar does not exist for whatever reason, no message is displayed and no error
  // occurs.
  //
  // message - A {String} containing the message to display.
  constructor(message, color = false) {
    this.statusBar = document.querySelector('status-bar');
    if (this.statusBar) {
      this.item = document.createElement('div');
      this.item.className = 'linter-clojure-repl inline-block';
      if (color) { this.item.style.color = color; }
      this.setText(message);

      this.tile = this.statusBar.addLeftTile({item: this.item});
    }
  }

  // Public: Removes the message from the status bar.
  remove() {
    return __guard__(this.tile, x => x.destroy());
  }

  // Public: Updates the text of the message.
  //
  // text - A {String} containing the new message to display.
  setText(text, status = false) {
    this.item.className = 'linter-clojure-repl inline-block';
    if (status) { this.item.classList.add(status); }
    if (this.statusBar) { return this.item.innerHTML = text; }
  }
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
