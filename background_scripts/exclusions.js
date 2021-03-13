const ExclusionRegexpCache = {
  cache: {},
  clear(cache) {
    this.cache = cache || {};
  },
  get(pattern) {
    if (pattern in this.cache) {
      return this.cache[pattern];
    } else {
      let result;
      // We use try/catch to ensure that a broken regexp doesn't wholly cripple Vimium.
      try {
        result = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      } catch (error) {
        BgUtils.log(`bad regexp in exclusion rule: ${pattern}`);
        result = /^$/; // Match the empty string.
      }
      this.cache[pattern] = result;
      return result;
    }
  }
};

function mergeKeys(aKeys, bKeys) {
  aKeys = !!aKeys ? aKeys : '';
  bKeys = !!bKeys ? bKeys : '';

  console.log(`XXX aKeys: `, aKeys);
  console.log(`XXX bKeys: `, bKeys);

  let keys = aKeys + bKeys;
  keys = Utils.distinctCharacters(keys);
  console.log(`XXX keys: `, keys);
  // Strip whitespace from all matching passKeys strings, and join them together.
  const result = keys.split(/\s+/).join("");
  console.log(`XXX merged result: `, result);
  return result;
};

function mergeCommands(as, bs) {
  as = !!as ? as : [];
  bs = !!bs ? bs : [];

  const allCmds = as.concat(bs);
  // unique them.
  return [...new Set(allCmds)];
};

// A rule defining whitelist/blacklist behavior on a page.
class ExclusionRule {
  // Rules were originally simply a pattern and a 'passKeys' property. This
  // property was a sequence of latters, eg 'abc', and whether or not a key was
  // blacklisted on a page, (or 'passed through', presumably), was as simple as
  // `passKeys.includs(char)`. This made it impossible (afaict) to prevent
  // mappings like <c-o> (see https://github.com/philc/vimium/issues/2184).
  //
  // New rules allow more complex behavior. passKeys still exist in order to
  // remain backwards compatible. We also introduce passMappings, to allow
  // things like <c-o> to be ignored.
  //
  // allowKeys and allowMappings are the same concepts, but whitelists rather
  // than blacklists. If <c-o> is set in allowMappings, eg, then it will always
  // work even if everything else is disabled.
  constructor(pattern, passKeys, passMappings, allowKeys, allowMappings) {
    this.pattern = pattern;
    this.passKeys = mergeKeys(passKeys, '');
    this.passMappings = passMappings;
    this.allowKeys = mergeKeys(allowKeys, '');
    this.allowMappings = allowMappings;
  }

  isEnabled() {
    const result = !this.excludeEverything();
    console.log(`XXX isEnabled: `, result);
    return result;
  }

  excludeEverything() {
    const result = !this.passKeys;
    console.log(`XXX excludeEverything: `, result);
    return result;
  }

  ignoreKeyChar(keyChar) {
    return this.passKeys.includes(keyChar);
  }

  ignoreMapping(mapping) {
    return this.passMappings.includes(mapping);
  }

  forceIncludeKeyChar(keyChar) {
    return this.allowKeys.includes(keyChar);
  }

  forceIncludeMapping(mapping) {
    return this.allowMappings.includes(mapping);
  }

  mergeRule(rule) {
    return new ExclusionRule(
      'merged-rule',
      mergeKeys(this.passKeys, rule.passKeys),
      mergeCommands(this.passMappings, rule.passMappings),
      mergeKeys(this.allowKeys, rule.allowKeys),
      mergeCommands(this.allowMappings, rule.allowMappings),
    );
  }
}

// The Exclusions class manages the exclusion rule setting.  An exclusion is an object with two attributes:
// pattern and passKeys.  The exclusion rules are an array of such objects.
var Exclusions = {
  // Make RegexpCache, which is required on the page popup, accessible via the Exclusions object.
  RegexpCache: ExclusionRegexpCache,

  rules: Settings.get("exclusionRules"),

  // Merge the matching rules for URL, or null.  In the normal case, we use the configured @rules; hence, this
  // is the default.  However, when called from the page popup, we are testing what effect candidate new rules
  // would have on the current tab.  In this case, the candidate rules are provided by the caller.
  getRule(url, rules) {
    if (rules == null)
      rules = this.rules;
    const matchingRawRules = rules.filter(r => r.pattern && (url.search(ExclusionRegexpCache.get(r.pattern)) >= 0));
    const matchingRules = matchingRawRules.map((rawRule) => {
      return new ExclusionRule(
        rawRule.pattern,
        rawRule.passKeys,
        [],
        '',
        [],
      );
    });
    console.log(`XXX getRule for url: ${url}`);
    console.log(`XXX getRule for url found [${matchingRules.length}] rules`);
    // An absolute exclusion rule (one with no passKeys) takes priority.
    let mergedRule = null;
    for (let rule of matchingRules) {
      if (!mergedRule) {
        mergedRule = rule;
      } else {
        mergedRule = mergedRule.mergeRule(rule);
      }
      if (rule.excludeEverything()) {
        // TODO: we'll need to change this so we can block everything EXCEPT.
        return rule;
      }
    }
    // Safe to return null if no rules match.
    return mergedRule;
  },

  isEnabledForUrl(url) {
    const rule = Exclusions.getRule(url);
    return {
      isEnabledForUrl: !rule || rule.isEnabled(),
      passKeys: rule ? rule.passKeys : "",
      rule: rule,
    };
  },

  setRules(rules) {
    // Callers map a rule to null to have it deleted, and rules without a pattern are useless.
    this.rules = rules.filter(rule => rule && rule.pattern);
    Settings.set("exclusionRules", this.rules);
  },

  postUpdateHook(rules) {
    // NOTE(mrmr1993): In FF, the |rules| argument will be garbage collected when the exclusions popup is
    // closed. Do NOT store it/use it asynchronously.
    this.rules = Settings.get("exclusionRules");
    ExclusionRegexpCache.clear();
  }
};

// Register postUpdateHook for exclusionRules setting.
Settings.postUpdateHooks["exclusionRules"] = Exclusions.postUpdateHook.bind(Exclusions);

global.Exclusions = Exclusions;
