import { describe, expect, it } from 'vitest';
import { isMissingArtifact } from './journey-artifact.ts';

describe('isMissingArtifact', () => {
  it("reads gh's answer for a name no artifact has as missing", () => {
    expect(isMissingArtifact('no artifact matches any of the names or patterns provided\n')).toBe(
      true,
    );
  });

  it("reads gh's answer for an artifact past its 30 days as missing", () => {
    // An expired artifact is listed but can't be downloaded (#171): the batch is refused with a reason.
    expect(isMissingArtifact('no valid artifacts found to download\n')).toBe(true);
  });

  it("reads the same answers behind gh's own prefix and in any case as missing", () => {
    expect(isMissingArtifact('gh: No Valid Artifacts found to download')).toBe(true);
    expect(isMissingArtifact('error: no artifact matches any of the names')).toBe(true);
  });

  it("doesn't read a network error, a rate limit or an auth error as missing", () => {
    for (const stderr of [
      'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com',
      'Get "https://api.github.com/repos/x/y/actions/runs/1/artifacts": dial tcp: lookup api.github.com: no such host',
      'HTTP 403: API rate limit exceeded (https://api.github.com/repos/x/y/actions/runs/1/artifacts)',
      'HTTP 401: Bad credentials',
      '',
    ])
      expect(isMissingArtifact(stderr), stderr).toBe(false);
  });

  it("doesn't read an error with no text as missing", () => {
    expect(isMissingArtifact(undefined)).toBe(false);
    expect(isMissingArtifact(null)).toBe(false);
    expect(isMissingArtifact(Buffer.from('no artifact matches any of the names'))).toBe(false);
  });
});
