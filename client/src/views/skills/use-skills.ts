// 技能目录（技能页自己读、自己存着）：读全、读坏了能再读、装了删了以后重读。

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SkillListResponse, SkillRow } from '../../api/shared.ts';
import { loadAllSkills } from './skill-text.ts';

export interface SkillsData {
  /** null = 还在读。 */
  skills: SkillRow[] | null;
  issues: SkillListResponse['issues'];
  error: boolean;
  reload: () => void;
}

export function useSkills(): SkillsData {
  const api = useApi();
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [issues, setIssues] = useState<SkillListResponse['issues']>([]);
  const [error, setError] = useState(false);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    loadAllSkills(api.skills, controller.signal).then((result) => {
      if (controller.signal.aborted) { return; }
      setSkills(result.skills);
      setIssues(result.issues);
    }, () => { if (!controller.signal.aborted) { setError(true); } });
    return () => controller.abort();
  }, [api, turn]);
  const reload = useCallback(() => setTurn((value) => value + 1), []);
  return { skills, issues, error, reload };
}
