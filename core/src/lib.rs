//! Mergecraft core: Git-Anbindung (über die echte `git`-CLI) und die
//! 3-Wege-Merge-Engine. Bewusst ohne GUI-Abhängigkeiten, damit alles schnell und
//! ohne WebKit/GTK testbar bleibt.

pub mod gitcli;
pub mod hunks;
pub mod merge;
pub mod model;
pub mod verify;

mod working;
