import { Response } from "express"


export const apiError = (res: Response, message: string, code = 403) => {
    return res.status(code).json({ success: false, message: message })
} 