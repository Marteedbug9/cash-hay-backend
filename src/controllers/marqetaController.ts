// src/controllers/marqetaController.ts

import { Request, Response } from 'express';
import { createCardholder } from '../config/marqetaService';



export const createCardholderController = async (req: Request, res: Response) => {

  try {
    const cardholder = await createCardholder();
    res.status(200).json(cardholder);
  } catch (error) {
    res.status(500).json({ error: 'Échec de création du cardholder.' });
  }
};
