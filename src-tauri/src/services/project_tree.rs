use rusqlite::Connection;

/// How deep the hierarchy is walked. The data model allows any depth; this cap
/// exists so a cycle that somehow reached the database — a hand-edited row, a
/// future bug — degrades into a truncated answer instead of an endless loop.
const MAX_DEPTH: i32 = 32;

/// A project and every project nested under it, at any depth.
///
/// Selecting a parent means selecting its whole subtree: that is what makes a
/// parent board read as one project. A leaf's subtree is just itself, so the
/// same query serves both cases and there is no second code path to keep right.
pub fn subtree_ids(conn: &Connection, root_id: &str) -> Vec<String> {
    let mut stmt = match conn.prepare(
        "WITH RECURSIVE subtree(id, depth) AS ( \
             SELECT ?1, 0 \
             UNION ALL \
             SELECT p.id, s.depth + 1 FROM projects p \
             JOIN subtree s ON p.parent_id = s.id \
             WHERE s.depth < ?2 \
         ) \
         SELECT id FROM subtree",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return vec![root_id.to_string()],
    };

    let ids = match stmt.query_map(rusqlite::params![root_id, MAX_DEPTH], |row| row.get(0)) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        // A subtree we cannot read must not silently widen into "all projects".
        Err(_) => vec![root_id.to_string()],
    };
    ids
}

/// `project_id IN (?, ?, …)` for a project's subtree, with the ids to bind.
///
/// Returned together so a caller cannot bind the wrong number of parameters.
pub fn subtree_filter(conn: &Connection, root_id: &str, column: &str) -> (String, Vec<String>) {
    let ids = subtree_ids(conn, root_id);
    let placeholders = vec!["?"; ids.len()].join(", ");
    (format!("{} IN ({})", column, placeholders), ids)
}

/// Would making `new_parent` the parent of `project_id` create a cycle?
///
/// True when the candidate parent is the project itself or already sits
/// somewhere below it — the two ways a subtree can be made to contain itself.
pub fn would_create_cycle(conn: &Connection, project_id: &str, new_parent: &str) -> bool {
    project_id == new_parent || subtree_ids(conn, project_id).iter().any(|id| id == new_parent)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::init_test_db;

    /// root → child → grandchild, plus an unrelated project.
    fn tree() -> Connection {
        let conn = init_test_db();
        conn.execute_batch(
            "INSERT INTO projects (id, name) VALUES ('root', 'Root'), ('other', 'Other');
             INSERT INTO projects (id, name, parent_id) VALUES ('child', 'Child', 'root');
             INSERT INTO projects (id, name, parent_id) VALUES ('grand', 'Grand', 'child');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn subtree_reaches_any_depth() {
        let conn = tree();
        let mut ids = subtree_ids(&conn, "root");
        ids.sort();
        assert_eq!(ids, vec!["child", "grand", "root"]);
    }

    #[test]
    fn a_child_selects_only_its_own_branch() {
        let conn = tree();
        let mut ids = subtree_ids(&conn, "child");
        ids.sort();
        assert_eq!(ids, vec!["child", "grand"]);
        assert_eq!(subtree_ids(&conn, "grand"), vec!["grand"]);
    }

    #[test]
    fn an_unrelated_project_stays_out() {
        let conn = tree();
        assert_eq!(subtree_ids(&conn, "other"), vec!["other"]);
    }

    #[test]
    fn filter_binds_one_placeholder_per_id() {
        let conn = tree();
        let (sql, ids) = subtree_filter(&conn, "root", "project_id");
        assert_eq!(ids.len(), 3);
        assert_eq!(sql.matches('?').count(), ids.len());
    }

    #[test]
    fn cycles_are_refused() {
        let conn = tree();
        // A project cannot be its own parent, nor adopt one of its descendants.
        assert!(would_create_cycle(&conn, "root", "root"));
        assert!(would_create_cycle(&conn, "root", "grand"));
        // Nesting under an unrelated project is fine.
        assert!(!would_create_cycle(&conn, "root", "other"));
        assert!(!would_create_cycle(&conn, "child", "other"));
    }
}
