"""
添加自主探索功能相关数据表

迁移脚本：创建exploration_tasks、discovered_models、exploration_reports三张表

执行方式：
python -m backend.app.db.migrations.add_exploration_tables
"""

from sqlalchemy import create_engine, text
from backend.app.core.config import settings


def upgrade():
    """创建自主探索相关表"""
    
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        # 创建exploration_tasks表
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS exploration_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id VARCHAR(64) UNIQUE NOT NULL,
                status VARCHAR(20) NOT NULL,
                source VARCHAR(50) NOT NULL,
                model_name VARCHAR(255) NOT NULL,
                model_url VARCHAR(512),
                discovery_time TIMESTAMP NOT NULL,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                error_message TEXT,
                progress TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_exploration_status_created 
            ON exploration_tasks(status, created_at)
        """))
        
        # 创建discovered_models表
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS discovered_models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name VARCHAR(255) NOT NULL,
                model_type VARCHAR(50),
                organization VARCHAR(255),
                release_date TIMESTAMP,
                source_platform VARCHAR(50) NOT NULL,
                source_uid VARCHAR(512) NOT NULL,
                github_url VARCHAR(512),
                paper_url VARCHAR(512),
                model_url VARCHAR(512),
                license VARCHAR(50),
                description TEXT,
                
                github_stars INTEGER DEFAULT 0,
                github_forks INTEGER DEFAULT 0,
                paper_citations INTEGER DEFAULT 0,
                social_mentions INTEGER DEFAULT 0,
                
                impact_score REAL,
                quality_score REAL,
                innovation_score REAL,
                practicality_score REAL,
                final_score REAL,
                
                status VARCHAR(20) DEFAULT 'discovered',
                is_notable BOOLEAN DEFAULT 0,
                extra_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_model_score_date 
            ON discovered_models(final_score, release_date)
        """))
        
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_model_status_score 
            ON discovered_models(status, final_score)
        """))

        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_model_source_uid_unique
            ON discovered_models(source_platform, source_uid)
        """))
        
        # 创建exploration_reports表
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS exploration_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_id VARCHAR(64) UNIQUE NOT NULL,
                task_id VARCHAR(64) NOT NULL,
                model_id INTEGER NOT NULL,
                
                title VARCHAR(255) NOT NULL,
                summary TEXT,
                highlights TEXT,
                technical_analysis TEXT,
                performance_analysis TEXT,
                code_analysis TEXT,
                use_cases TEXT,
                risks TEXT,
                recommendations TEXT,
                references TEXT,
                full_report TEXT,
                
                report_version VARCHAR(20) DEFAULT '1.0',
                agent_version VARCHAR(20),
                model_used VARCHAR(100),
                generation_time REAL,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                FOREIGN KEY (model_id) REFERENCES discovered_models(id)
            )
        """))
        
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_report_model_generated 
            ON exploration_reports(model_id, generated_at)
        """))
        
        conn.commit()
        
    print("✅ 自主探索相关表创建成功!")
    print("   - exploration_tasks")
    print("   - discovered_models")
    print("   - exploration_reports")


def downgrade():
    """删除自主探索相关表"""
    
    engine = create_engine(settings.DATABASE_URL)
    
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS exploration_reports"))
        conn.execute(text("DROP TABLE IF EXISTS discovered_models"))
        conn.execute(text("DROP TABLE IF EXISTS exploration_tasks"))
        conn.commit()
        
    print("✅ 自主探索相关表已删除")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "downgrade":
        downgrade()
    else:
        upgrade()
