process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://pwc:pwc_dev_password@localhost:5432/pwc_counselling_test?schema=public";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";
