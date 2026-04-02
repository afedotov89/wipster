use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconEvent,
    App, Manager,
};

fn load_tray_icon() -> Result<Image<'static>, Box<dyn std::error::Error>> {
    let png_data = include_bytes!("../../icons/tray-icon.png");
    let decoder = png::Decoder::new(&png_data[..]);
    let mut reader = decoder.read_info()?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf)?;
    buf.truncate(info.buffer_size());

    Ok(Image::new_owned(buf, info.width, info.height))
}

pub fn setup(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit Wipster", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Wipster", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = load_tray_icon()?;

    let _tray = tauri::tray::TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .icon_as_template(true)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    if let Some(window) = tray.app_handle().get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
