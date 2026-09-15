//! The promise that nothing the user can do stays out of the assistant's reach.
//!
//! Every Tauri command registered in `lib.rs` has to appear below, either
//! pointing at the tool that covers it or saying in writing why the assistant
//! has no business with it. A new command that is neither fails the test, which
//! is the only way a rule like "every control is available to the AI" survives
//! contact with a growing app: it stops being a habit and becomes a build error.

/// What the assistant can do about a given command.
#[derive(Debug)]
#[allow(dead_code)] // read by the tests below, which are the point of this file
pub enum Coverage {
    /// Reachable through this tool.
    Tool(&'static str),
    /// Deliberately not exposed, for the reason given.
    Withheld(&'static str),
}

use Coverage::{Tool, Withheld};

#[allow(dead_code)] // the contract itself; the tests are its only reader
pub const COMMANDS: &[(&str, Coverage)] = &[
    // --- Projects
    ("list_projects", Tool("list_projects")),
    ("create_project", Tool("create_project")),
    ("update_project", Tool("update_project")),
    ("delete_project", Tool("delete_project")),
    ("project_delete_impact", Withheld("the delete tool reports the same numbers in its answer")),
    // --- Tasks
    ("list_tasks", Tool("list_tasks")),
    ("create_task", Tool("create_task")),
    ("get_task", Tool("get_task")),
    ("update_task", Tool("update_task")),
    ("delete_task", Tool("delete_task")),
    ("move_task", Tool("move_task")),
    ("get_doing_tasks", Tool("list_tasks")),
    ("get_project_task_counts", Tool("list_tasks")),
    ("reorder_tasks", Tool("reorder_tasks")),
    ("list_archived_tasks", Tool("list_archived_tasks")),
    ("set_task_archived", Tool("set_task_archived")),
    ("get_promised_to_options", Withheld("autocomplete for a text field; the values come from tasks the assistant can already read")),
    ("get_estimate_options", Withheld("autocomplete for a text field; the values come from tasks the assistant can already read")),
    // --- Board rules
    ("get_wip_limit", Tool("get_wip_limit")),
    ("set_wip_limit", Tool("set_wip_limit")),
    // --- History
    ("undo_last", Tool("undo_last")),
    ("redo_last", Tool("redo_last")),
    ("get_changelog", Tool("recent_changes")),
    // --- Context capture
    ("capture_context", Withheld("captured automatically when a task is paused, not a control anyone presses")),
    ("get_task_contexts", Withheld("shown on the task itself; nothing for the assistant to act on")),
    // --- Settings
    ("get_setting", Withheld("raw settings access would hand over the API keys; the settings worth changing have their own tools")),
    ("set_setting", Withheld("raw settings access would let the assistant rewrite the API keys; the settings worth changing have their own tools")),
    ("test_llm_connection", Withheld("a check on the assistant's own connection, which it cannot usefully run on itself")),
    ("llm_providers", Withheld("the list of services the app can be pointed at; choosing one means pasting a key, which only the user has")),
    ("app_info", Tool("release_notes")),
    ("open_path", Withheld("launching whatever is at a path on this machine is the user's click to make, not the assistant's")),
    ("reveal_path", Withheld("same: showing a file in Finder follows the user's own click on the row")),
    // --- The shape of a task
    ("task_field_kinds", Withheld("the list of types a field can have; the create tool names them in its own schema")),
    ("list_task_fields", Tool("list_task_fields")),
    ("removed_task_fields", Tool("list_task_fields")),
    ("create_task_field", Tool("create_task_field")),
    ("update_task_field", Tool("update_task_field")),
    ("reorder_task_fields", Withheld("dragging fields into an order is a mouse gesture; the assistant changes which fields exist, not their pixel order")),
    ("remove_task_field", Tool("remove_task_field")),
    ("restore_task_field", Tool("update_task_field")),
    ("task_field_values", Tool("get_task")),
    ("set_task_field_value", Tool("set_task_field")),
    ("get_backend_logs", Withheld("diagnostics for the log view")),
    // --- The assistant itself
    ("agent_chat", Withheld("this is the assistant's own entry point")),
    ("agent_cancel", Withheld("stopping a run is the user's move, not the assistant's")),
    ("agent_confirm", Withheld("executes what the user confirmed; the assistant already asked")),
    ("ai_autocomplete", Withheld("inline completion inside a text field")),
    ("ai_fill_task", Withheld("the assistant fills fields directly with update_task")),
    ("create_chat_session", Withheld("the chat's own plumbing")),
    ("list_chat_sessions", Withheld("the chat's own plumbing")),
    ("get_chat_messages", Withheld("the chat's own plumbing")),
    ("add_chat_message", Withheld("the chat's own plumbing")),
    ("update_chat_message", Withheld("the chat's own plumbing")),
    ("update_chat_confirmation", Withheld("the chat's own plumbing")),
    ("delete_chat_session", Withheld("the chat's own plumbing")),
    ("recent_user_prompts", Withheld("feeds the panel's hints")),
    // --- Tracker
    ("tracker_start_auth", Withheld("an OAuth flow the user has to walk through in a browser")),
    ("tracker_poll_token", Withheld("part of that same OAuth flow")),
    ("tracker_status", Withheld("the issue tools say themselves when it is not configured")),
    ("gitlab_configure", Withheld("stores a credential the user types in Settings")),
    ("gitlab_status", Withheld("the issue tools say themselves when it is not configured")),
    ("gitlab_test", Withheld("a settings check the user runs on their own token")),
    ("is_bare_issue_reference", Withheld("a text check the panel uses to decide whether to auto-fill")),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Every `commands::module::name` registered with Tauri.
    fn registered_commands() -> Vec<String> {
        let lib = include_str!("../../lib.rs");
        let start = lib.find("tauri::generate_handler![").expect("no command list in lib.rs");
        let end = lib[start..].find("])").expect("unterminated command list") + start;

        lib[start..end]
            .lines()
            .filter_map(|line| line.trim().strip_suffix(','))
            .filter_map(|entry| entry.rsplit("::").next())
            .map(str::to_string)
            .collect()
    }

    /// A parser that quietly finds nothing would make every check below pass
    /// while covering nothing at all.
    #[test]
    fn the_command_list_is_actually_being_read() {
        let commands = registered_commands();
        assert!(
            commands.len() > 30,
            "only {} commands parsed out of lib.rs — the parser has drifted from the file",
            commands.len(),
        );
        assert!(commands.iter().any(|c| c == "create_task"));
    }

    #[test]
    fn every_command_is_either_a_tool_or_withheld_on_purpose() {
        let listed: HashSet<&str> = COMMANDS.iter().map(|(name, _)| *name).collect();
        let missing: Vec<String> = registered_commands()
            .into_iter()
            .filter(|command| !listed.contains(command.as_str()))
            .collect();

        assert!(
            missing.is_empty(),
            "these commands reach the user but not the assistant: {:?}\n\
             Add a tool for each and map it in coverage.rs, or record why it is withheld.",
            missing,
        );
    }

    #[test]
    fn every_tool_named_in_the_map_exists() {
        let registry: HashSet<&str> = super::super::registry().iter().map(|t| t.name).collect();
        for (command, coverage) in COMMANDS {
            if let Tool(tool) = coverage {
                assert!(
                    registry.contains(tool),
                    "{} is mapped to the tool {}, which is not in the registry",
                    command,
                    tool,
                );
            }
        }
    }

    #[test]
    fn the_map_has_no_entries_for_commands_that_are_gone() {
        let registered: HashSet<String> = registered_commands().into_iter().collect();
        let stale: Vec<&str> = COMMANDS
            .iter()
            .map(|(name, _)| *name)
            .filter(|name| !registered.contains(*name))
            .collect();

        assert!(stale.is_empty(), "coverage.rs still lists commands that no longer exist: {:?}", stale);
    }

    /// A tool that asks the interface for something nobody answers would report
    /// success and change nothing. The window's half of the contract is checked
    /// here, against the file that implements it.
    #[test]
    fn every_ui_tool_is_answered_by_the_interface() {
        let dispatcher = include_str!("../../../../frontend/src/stores/aiUiCommands.ts");
        for tool in super::super::registry() {
            if let super::super::Handler::Ui(action) = tool.handler {
                assert!(
                    dispatcher.contains(&format!("case \"{}\":", action)),
                    "the tool {} asks the interface to \"{}\", but aiUiCommands.ts does not handle it",
                    tool.name,
                    action,
                );
            }
        }
    }

    #[test]
    fn every_tool_offers_the_model_a_usable_schema() {
        for tool in super::super::registry() {
            let params = (tool.params)();
            assert_eq!(
                params["type"], "object",
                "{}'s parameters must be an object schema",
                tool.name
            );
            assert!(!tool.summary.is_empty(), "{} has no summary", tool.name);
            assert!(!tool.keywords.is_empty(), "{} cannot be found: no keywords", tool.name);
        }
    }
}
