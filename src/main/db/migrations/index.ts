// Migrações versionadas, aplicadas em ordem via PRAGMA user_version.
import m001 from './001_init';
import m002 from './002_days';
import m003 from './003_pipos';
import m004 from './004_pipo_files';

const migrations: string[] = [m001, m002, m003, m004];

export default migrations;
