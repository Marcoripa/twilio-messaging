export interface Contact {
  phone: string;
  contact: {
    id: string;
    conversation_sid: string;
    createdTime: string;
    fields: {
      Name: string;
      'Shoot Date'?: string;
      Phone: string;
      Email?: string;
    };
  };

  is_selected: boolean;
}
