export interface Contact {
  phone: string;

  contact: {
    id: string;
    createdTime: string;
    fields: {
      Name: string;
      'Shoot Date'?: string;
      Phone: string;
      Email?: string;
    };
  } | null;

  is_selected: boolean;

  last_message: {
    from: string;
    to: string;
    body: string;
    date_created: string;
  } | null;

  messages: {
    from: string;
    to: string;
    body: string;
    date_created: string;
  }[];
}
