import assert from 'node:assert/strict'
import test from 'node:test'
import { branchWebUrl } from '../server/utils/branch-url.ts'

test('GitHub HTTP(S)/SSH/scp remotes normalize to the actual upstream branch', () => {
  for (const remote of [
    'http://github.com/team/project.git',
    'https://github.com/team/project.git',
    'ssh://git@github.com/team/project.git',
    'git@github.com:team/project.git'
  ]) {
    assert.equal(branchWebUrl(remote, 'refs/heads/feature/shared'), 'https://github.com/team/project/tree/feature%2Fshared')
  }
})

test('GitLab nested namespaces and Bitbucket branch URLs', () => {
  for (const remote of [
    'https://gitlab.com/team/subgroup/project.git',
    'ssh://git@gitlab.com/team/subgroup/project.git',
    'git@gitlab.com:team/subgroup/project.git'
  ]) {
    assert.equal(branchWebUrl(remote, 'refs/heads/topic/slash'), 'https://gitlab.com/team/subgroup/project/-/tree/topic%2Fslash')
  }
  for (const remote of [
    'https://bitbucket.org/team/project.git',
    'ssh://git@bitbucket.org/team/project.git',
    'git@bitbucket.org:team/project.git'
  ]) {
    assert.equal(branchWebUrl(remote, 'refs/heads/topic/slash'), 'https://bitbucket.org/team/project/src/topic%2Fslash')
  }
})

test('credentials, query strings, fragments and SSH users never reach branch links', () => {
  for (const remote of [
    'https://person:secret@github.com/team/project.git?token=secret#secret',
    'http://person:secret@github.com/team/project.git?token=secret#secret',
    'ssh://person:secret@github.com:22/team/project.git?token=secret#secret',
    'person@github.com:team/project.git?token=secret#secret'
  ]) {
    const result = branchWebUrl(remote, 'refs/heads/main')
    assert.equal(result, 'https://github.com/team/project/tree/main')
    assert(!result.includes('secret'))
    assert.equal(new URL(result).username, '')
  }
  assert.equal(branchWebUrl('https://github.com/team/project%20name.git', 'refs/heads/feature/été'),
    'https://github.com/team/project%20name/tree/feature%2F%C3%A9t%C3%A9')
})

test('unsupported remotes, ambiguous paths and missing branch refs have no link', () => {
  for (const remote of [
    'https://forge.example/team/project.git',
    'https://github.com.evil.test/team/project.git',
    'https://github.com@evil.test/team/project.git',
    'file:///private/project',
    '/local/project',
    'https://github.com/team/project/extra',
    'https://github.com/team/%2fproject',
    'not a remote'
  ]) {
    assert.equal(branchWebUrl(remote, 'refs/heads/main'), null)
  }
  for (const ref of ['', 'main', 'refs/tags/v1', 'refs/heads/']) {
    assert.equal(branchWebUrl('https://github.com/team/project.git', ref), null)
  }
})
