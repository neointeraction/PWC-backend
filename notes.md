
DATABASE_URL="postgresql://neondb_owner:npg_XOwP91dpARVe@ep-late-haze-ayzzdovb-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" npx prisma migrate deploy


DATABASE_URL="postgresql://neondb_owner:npg_XOwP91dpARVe@ep-late-haze-ayzzdovb-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" pnpm db:seed

/opt/homebrew/opt/postgresql@18/bin/pg_dump "postgresql://neondb_owner:npg_XOwP91dpARVe@ep-late-haze-ayzzdovb.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" -F c -f live_backup_before_wipe.dump

/opt/homebrew/opt/postgresql@18/bin/pg_dump


psql "postgresql://neondb_owner:npg_XOwP91dpARVe@ep-late-haze-ayzzdovb.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require" -c 'DELETE FROM "projects";'

psql "" -c 'DELETE FROM "users" WHERE role = '\''STUDENT'\'';'