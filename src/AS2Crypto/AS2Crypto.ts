import {
  CRLF,
  ENCRYPTION_FILENAME,
  SIGNATURE_FILENAME,
  ERROR
} from '../Constants'
import { AS2MimeNode } from '../AS2MimeNode'
import { encryptionOptions, canonicalTransform } from '../Helpers'
import * as MimeNode from 'nodemailer/lib/mime-node'
import {
  EncryptionOptions,
  SigningOptions,
  DecryptionOptions,
  VerificationOptions
} from './Interfaces'
import { AS2Parser } from '../AS2Parser'
import { randomBytes } from 'crypto'
import { AS2SignedData } from './AS2SignedData'
import { AS2EnvelopedData } from './AS2EnvelopedData'

/** Class for cryptography methods supported by AS2. */
export class AS2Crypto {
  private static async buildNode (node: AS2MimeNode): Promise<Buffer> {
    return node.parsed
      ? await node.build()
      : await MimeNode.prototype.build.bind(node)()
  }

  /** A fix for signing with Nodemailer to produce verifiable SMIME;
   * the library joins multipart boundaries without the part's trailing CRLF,
   * where OpenSSL and other SMIME clients keep each part's last CRLF. */
  static removeTrailingCrLf (buffer: Buffer): Buffer {
    const trailingBytes = buffer.slice(buffer.length - 2, buffer.length)

    return trailingBytes.toString('utf8') === CRLF
      ? buffer.slice(0, buffer.length - 2)
      : buffer
  }

  /** Crux to generate UUID-like random strings */
  static generateUniqueId (): string {
    const byteLengths = [4, 2, 2, 2, 6]

    return byteLengths
      .map(byteLength => randomBytes(byteLength).toString('hex'))
      .join('-')
  }

  /** Method to decrypt an AS2MimeNode from a PKCS7 encrypted AS2MimeNode. */
  static async decrypt (
    node: AS2MimeNode,
    options: DecryptionOptions
  ): Promise<AS2MimeNode> {
    const data: Buffer = Buffer.isBuffer(node.content)
      ? node.content
      : Buffer.from(node.content as string, 'base64')
    const envelopedData = new AS2EnvelopedData(data, true)
    const buffer = await envelopedData.decrypt(options.cert, options.key)
    const revivedNode = await AS2Parser.parse(buffer)

    return revivedNode
  }

  /** Method to envelope an AS2MimeNode in an encrypted AS2MimeNode. */
  static async encrypt (
    node: AS2MimeNode,
    options: EncryptionOptions
  ): Promise<AS2MimeNode> {
    options = encryptionOptions(options)
    const rootNode = new AS2MimeNode({
      filename: ENCRYPTION_FILENAME,
      contentType: 'application/pkcs7-mime; smime-type=enveloped-data'
    })

    canonicalTransform(node)

    const buffer = await AS2Crypto.buildNode(node)
    const envelopedData = new AS2EnvelopedData(buffer)
    const derBuffer = await envelopedData.encrypt(
      options.cert,
      options.encryption
    )

    rootNode.setContent(derBuffer)

    return rootNode
  }

  /** Method to verify data has not been modified from a signature. */
  static async verify (
    node: AS2MimeNode,
    options: VerificationOptions
  ): Promise<boolean> {
    const contentPart = await AS2Crypto.buildNode(node.childNodes[0])
    const contentPartNoCrLf = AS2Crypto.removeTrailingCrLf(contentPart)
    const signaturePart = Buffer.isBuffer(node.childNodes[1].content)
      ? node.childNodes[1].content
      : Buffer.from(node.childNodes[1].content as string, 'base64')
    const signedData = new AS2SignedData(contentPart, signaturePart)

    // Deal with Nodemailer trailing CRLF bug by trying with and without CRLF
    if (await signedData.verify(options.cert)) {
      return true
    }

    const signedDataNoCrLf = new AS2SignedData(contentPartNoCrLf, signaturePart)

    return await signedDataNoCrLf.verify(options.cert)
  }

  /** Method to sign data against a certificate and key pair. */
  static async sign (
    node: AS2MimeNode,
    options: SigningOptions
  ): Promise<AS2MimeNode> {
    const rootNode = new AS2MimeNode({
      contentType: `multipart/signed; protocol="application/pkcs7-signature"; micalg=${options.micalg};`,
      encrypt: (node as any)._encrypt
    })
    const contentNode = rootNode.appendChild(node) as AS2MimeNode
    const contentHeaders: Array<{
      key: string
      value: string
    }> = (contentNode as any)._headers

    for (let i = 0, len = contentHeaders.length; i < len; i++) {
      const header = contentHeaders[i]

      if (header.key.toLowerCase() === 'content-type') continue

      rootNode.setHeader(header.key, header.value)
      contentHeaders.splice(i, 1)
      i--
      len--
    }

    canonicalTransform(contentNode)

    const canonical = AS2Crypto.removeTrailingCrLf(
      await AS2Crypto.buildNode(contentNode)
    )

    const signedData = new AS2SignedData(canonical)
    const derBuffer = await signedData.sign({
      cert: options.cert,
      key: options.key,
      algorithm: options.micalg
    })

    rootNode.appendChild(
      new AS2MimeNode({
        filename: SIGNATURE_FILENAME,
        contentType: 'application/pkcs7-signature',
        content: derBuffer
      })
    ) as AS2MimeNode

    return rootNode
  }

  /** Not yet implemented; do not use.
   * @throws ERROR.NOT_IMPLEMENTED
   */
  static async compress (
    node: AS2MimeNode,
    options: any
  ): Promise<AS2MimeNode> {
    throw new Error(ERROR.NOT_IMPLEMENTED)
  }

  /** Not yet implemented; do not use.
   * @throws ERROR.NOT_IMPLEMENTED
   */
  static async decompress (
    node: AS2MimeNode,
    options: any
  ): Promise<AS2MimeNode> {
    throw new Error(ERROR.NOT_IMPLEMENTED)
  }
}
