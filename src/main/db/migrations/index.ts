// Migrações versionadas, aplicadas em ordem via PRAGMA user_version.
import m001 from './001_init';
import m002 from './002_days';
import m003 from './003_pipos';
import m004 from './004_pipo_files';
import m005 from './005_pipo_tokens';
import m006 from './006_goals';
import m007 from './007_decisions';
import m008 from './008_decision_vectors';
import m009 from './009_no_focus';
import m010 from './010_improve';
import m011 from './011_team';

const migrations: string[] = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011];

export default migrations;
