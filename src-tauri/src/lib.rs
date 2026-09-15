mod commands;
mod db;
mod models;
mod services;
mod tray;

use tauri::Manager;

use db::connection::DbState;

pub fn run() {
    install_panic_logger();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let db = db::connection::init_db(app.handle())?;
            app.manage(DbState::new(db));

            // Tools that act on the interface need a window to talk to.
            services::ui_bridge::attach(app.handle().clone());

            if let Err(e) = tray::setup(app) {
                eprintln!("Tray setup failed (non-fatal): {}", e);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project_commands::list_projects,
            commands::project_commands::create_project,
            commands::project_commands::update_project,
            commands::project_commands::delete_project,
            commands::project_commands::project_delete_impact,
            commands::task_commands::list_tasks,
            commands::task_commands::create_task,
            commands::task_commands::get_task,
            commands::task_commands::update_task,
            commands::task_commands::delete_task,
            commands::task_commands::move_task,
            commands::task_commands::get_doing_tasks,
            commands::task_commands::get_promised_to_options,
            commands::task_commands::get_project_task_counts,
            commands::task_commands::reorder_tasks,
            commands::task_commands::get_estimate_options,
            commands::task_commands::list_archived_tasks,
            commands::task_commands::set_task_archived,
            commands::task_commands::get_wip_limit,
            commands::task_commands::set_wip_limit,
            commands::changelog_commands::undo_last,
            commands::changelog_commands::redo_last,
            commands::changelog_commands::get_changelog,
            commands::context_commands::capture_context,
            commands::context_commands::get_task_contexts,
            commands::agent_commands::get_backend_logs,
            commands::agent_commands::get_setting,
            commands::agent_commands::set_setting,
            commands::agent_commands::agent_chat,
            commands::agent_commands::agent_cancel,
            commands::agent_commands::agent_confirm,
            commands::agent_commands::test_llm_connection,
            commands::agent_commands::llm_providers,
            commands::app_commands::app_info,
            commands::autocomplete_commands::ai_autocomplete,
            commands::ai_fill_commands::ai_fill_task,
            commands::chat_commands::create_chat_session,
            commands::chat_commands::list_chat_sessions,
            commands::chat_commands::get_chat_messages,
            commands::chat_commands::add_chat_message,
            commands::chat_commands::update_chat_message,
            commands::chat_commands::update_chat_confirmation,
            commands::chat_commands::delete_chat_session,
            commands::chat_commands::recent_user_prompts,
            commands::tracker_commands::tracker_start_auth,
            commands::tracker_commands::tracker_poll_token,
            commands::tracker_commands::tracker_status,
            commands::tracker_commands::gitlab_configure,
            commands::tracker_commands::gitlab_status,
            commands::tracker_commands::gitlab_test,
            commands::tracker_commands::is_bare_issue_reference,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wipster");
}

/// Route panics into the in-app log.
///
/// A panic inside a command kills that task without ever answering the
/// frontend, so the only trace it used to leave was stderr nobody reads while
/// the UI sat on a spinner.
fn install_panic_logger() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_string());
        services::logger::log("error", &format!("[panic] {} at {}", message, location));
        previous(info);
    }));
}
