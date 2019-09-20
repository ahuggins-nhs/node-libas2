import 'mocha'
import { AS2Crypto, AS2MimeSection, AS2MimeMultipartSigned } from '../core'

import fs = require('fs')

const data = fs.readFileSync('test/test-data/content.txt', 'utf8')
const cert = fs.readFileSync('test/test-data/sample_cert.cer', 'utf8')
const key = fs.readFileSync('test/test-data/sample_priv.key', 'utf8')
const run = function run (command: string): Promise<string> {

  return new Promise((resolve, reject) => {
    const cp = require('child_process')
    const output: string[] = []
    const error: string[] = []
    const child = cp.exec(command)

    child.stdout.on('data', (data: string) => output.push(data))
    child.stderr.on('data', (data: string) => error.push(data))
    child.on('close', () => {
      resolve(output.join(''))
    })
    child.on('error', (err: Error) => reject(err))
  })
}

describe('AS2Encoder', () => {
  it('should match makemime output.', async () => {
    const mime = new AS2MimeSection(data)
    const makemime = await run('bash -c "makemime -c "text/plain" -e 8bit test/test-data/content.txt"')

    // Command 'makemime' encodes using lf instead of crlf; need to investigate as this is not per rfc, I think.
    if (mime.toString().replace(/\r\n/gu, '\n') !== makemime) {
      throw new Error(`Mime section not correctly constructed.\nExpected: '${makemime}'\nReceived: '${mime.toString()}'`)
    }
  })

  it('should be verified by openssl.', async () => {
    const mime = new AS2MimeSection(data)
    const smime = new AS2MimeMultipartSigned(mime, cert, key, 'sha256')

    fs.writeFileSync('test/temp-data/multipart.txt', smime.toString())

    const openssl = await run('bash -c "openssl smime -verify -noverify -in test/temp-data/multipart.txt -signer test/test-data/sample_cert.cer"')

    if (mime.toString() !== openssl) {
      throw new Error(`Mime section not correctly constructed.\nExpected: '${openssl}'\nReceived: '${mime.toString()}'`)
    }
  })
})