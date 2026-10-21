#!/usr/bin/env python3
# Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
#
# Makes the tables of the languages of Vader's screens (Arabic, Chinese) from the translation files kept in
# src/vs/workbench/contrib/vader/browser/react/src/util/i18n/source/:
#   ar-*.tsv and zh-*.tsv      one language: the English text, then " ::: ", then the text in that language
#   both-*.tsv                 both: the English text ::: Arabic ::: Chinese
# A text with a number or a name in it is a template: {0}, {1} stand for the parts that change. A later file (by name) wins over an earlier one. Lines starting with # are notes.
# Run: python build/lib/vader/genI18nTables.py        (writes util/i18n/ar.ts and zh.ts)
# What is still English: run the UI tests with VADER_I18N_MISSING=<file> (docs/integrations/language.md).

import html
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'src', 'vs', 'workbench', 'contrib', 'vader', 'browser', 'react', 'src', 'util', 'i18n')
SOURCE = os.path.join(ROOT, 'source')
NAMES = {'ar': 'Arabic', 'zh': 'Chinese (Simplified)'}
SEP = ' ::: '
NL = chr(10)

for lang in ('ar', 'zh'):
    table = {}
    for name in sorted(os.listdir(SOURCE)):
        if not name.endswith('.tsv'):
            continue
        with open(os.path.join(SOURCE, name), encoding='utf8') as f:
            lines = f.read().split(NL)
        for line in lines:
            if not line.strip() or line.startswith('#'):
                continue
            if name.startswith(lang + '-'):
                key, _, value = line.partition(SEP)
                if value.strip():
                    table[html.unescape(key.strip())] = value.strip()
            elif name.startswith('both-'):
                parts = [p.strip() for p in line.split(SEP)]
                if len(parts) == 3 and parts[1 if lang == 'ar' else 2]:
                    table[html.unescape(parts[0])] = parts[1 if lang == 'ar' else 2]
    body = (',' + NL).join('\t%s: %s' % (json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)) for k, v in sorted(table.items()))
    header = ('/*--------------------------------------------------------------------------------------' + NL
              + ' *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.' + NL
              + ' *--------------------------------------------------------------------------------------*/' + NL + NL
              + '// %s: the text of the screens, from the English text to this language. A text with a number or a name in it is a template ({0}, {1}); see translator.ts.' % NAMES[lang] + NL
              + '// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genI18nTables.py from util/i18n/source/*.tsv. A text that is missing here shows in English.' + NL + NL)
    with open(os.path.join(ROOT, lang + '.ts'), 'w', encoding='utf8', newline=NL) as out:
        out.write(header + 'export const %s: Record<string, string> = {%s%s%s}%s' % (lang, NL, body, NL, NL))
    print('%s: %d texts' % (lang, len(table)))
