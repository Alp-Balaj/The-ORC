# afterdone markers

missions.ts afterDone now calls missionGit.markersLeft(a.cwd, a.conflictFiles) instead of an inline regex. markersLeft matches opening (<<<<<<<) and closing (>>>>>>>) markers (not =======), so files with only a closing marker are now caught too.
