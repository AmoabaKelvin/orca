// Project files that name themselves without an extension. Shared by terminal bare-word
// detection and chat path linkification so both agree on what counts as a filename.
// Why no `BUILD` or `WORKSPACE`: both read as ordinary words in build output, and a bare
// candidate costs a filesystem stat on every host, including SSH.
export const EXTENSIONLESS_FILENAMES = new Set([
  'AUTHORS',
  'Brewfile',
  'Caddyfile',
  'CHANGELOG',
  'CODEOWNERS',
  'Containerfile',
  'CONTRIBUTING',
  'CONTRIBUTORS',
  'COPYING',
  'Dockerfile',
  'Fastfile',
  'Gemfile',
  'GNUmakefile',
  'Jenkinsfile',
  'Justfile',
  'justfile',
  'LICENCE',
  'LICENSE',
  'Makefile',
  'makefile',
  'NOTICE',
  'Podfile',
  'Procfile',
  'Rakefile',
  'README',
  'Vagrantfile'
])
