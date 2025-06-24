import { decrypt, encrypt } from "./cipher"

export const generateKey =  async (userId: string, lastKeyGeneratedAt: string, secret: string) => {
    return await encrypt(`${userId}--${lastKeyGeneratedAt}`, secret)
}

export const decryptKey = async (key: string, secret: string) => {
    const decrypted = await decrypt(key, secret)

    return decrypted.split("--")
}