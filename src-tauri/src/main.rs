// Prevent an additional console window on Windows (dev + release).
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    zemu_launcher_lib::run();
}
