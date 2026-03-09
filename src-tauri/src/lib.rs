use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(
                    "sqlite:data.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "create tables",
                            sql: r#"
                                CREATE TABLE IF NOT EXISTS users (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    username TEXT NOT NULL UNIQUE,
                                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                                );
                                CREATE TABLE IF NOT EXISTS exam_records (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    user_id INTEGER NOT NULL,
                                    exam_type TEXT NOT NULL,
                                    score REAL,
                                    total_questions INTEGER,
                                    correct_count INTEGER,
                                    duration_seconds INTEGER,
                                    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                    FOREIGN KEY (user_id) REFERENCES users(id)
                                );
                                CREATE TABLE IF NOT EXISTS question_answers (
                                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                                    record_id INTEGER NOT NULL,
                                    question_id TEXT NOT NULL,
                                    user_answer TEXT,
                                    is_correct BOOLEAN,
                                    FOREIGN KEY (record_id) REFERENCES exam_records(id)
                                );
                            "#,
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
