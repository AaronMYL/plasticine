import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proposedAgreementText } from '../../shared/agreement-diff.ts';

test('整段提议保留空行与正文缩进，只替换对应旧文', () => {
  assert.equal(proposedAgreementText('  保留缩进\n旧句\n', '   保留缩进\n- 旧句\n+ 新句\n'),
    '  保留缩进\n新句\n');
  assert.equal(proposedAgreementText('原文', '- 原文\n+ 新文'), '新文');
});

test('旧文不匹配、只有说明、删成空白的提议拒绝应用', () => {
  assert.equal(proposedAgreementText('改过的原文', '- 原文\n+ 新文'), null);
  assert.equal(proposedAgreementText('原文', '建议换个说法'), null);
  assert.equal(proposedAgreementText('原文', '- 原文\n+ '), null);
});
